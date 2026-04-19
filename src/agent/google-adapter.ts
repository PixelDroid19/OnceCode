/**
 * Google Gemini API adapter.
 *
 * Converts the internal `ChatMessage` format to Google's content/parts
 * wire format and handles both batch and SSE streaming responses.
 */

import type { RuntimeConfig } from '@/config/runtime.js'
import { parseAssistantText } from '@/agent/assistant-text.js'
import type {
  AgentStep,
  ChatMessage,
  ModelAdapter,
  ModelRequestOptions,
  StepDiagnostics,
  TokenUsage,
  ToolCall,
} from '@/types.js'
import type { ToolRegistry } from '@/tools/framework.js'
import { readJsonBody } from '@/utils/http.js'
import { resolveMaxOutputTokens } from '@/context/window.js'
import { post } from '@/agent/request.js'

type Part =
  | { text: string }
  | { functionCall: { name: string; args?: unknown } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type Content = {
  role: 'user' | 'model'
  parts: Part[]
}

function usage(raw?: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  cachedContentTokenCount?: number
}): TokenUsage | undefined {
  if (!raw) return undefined
  return {
    inputTokens: raw.promptTokenCount ?? 0,
    outputTokens: raw.candidatesTokenCount ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: raw.cachedContentTokenCount ?? 0,
  }
}

/** Converts internal ChatMessage array to Google's system + contents format. */
function convert(messages: ChatMessage[]): {
  system: string
  contents: Content[]
} {
  const system = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n')
  const contents: Content[] = []

  const push = (role: 'user' | 'model', part: Part) => {
    const last = contents.at(-1)
    if (last?.role === role) {
      last.parts.push(part)
      return
    }
    contents.push({ role, parts: [part] })
  }

  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      push('user', { text: msg.content })
      continue
    }

    if (msg.role === 'assistant' || msg.role === 'assistant_progress') {
      push('model', { text: msg.content })
      continue
    }

    if (msg.role === 'assistant_tool_call') {
      push('model', { functionCall: { name: msg.toolName, args: msg.input } })
      continue
    }

    push('user', {
      functionResponse: {
        name: msg.toolName,
        response: { content: msg.content, is_error: msg.isError },
      },
    })
  }

  return { system, contents }
}

/** Builds a unified AgentStep from parsed Google response data. */
function step(args: {
  text: string
  calls: ToolCall[]
  usage?: TokenUsage
  reason?: string
}): AgentStep {
  const parsed = parseAssistantText(args.text)
  const diagnostics: StepDiagnostics = {
    stopReason: args.reason,
    blockTypes: args.calls.length > 0 ? ['text', 'functionCall'] : ['text'],
    ignoredBlockTypes: [],
  }

  if (args.calls.length > 0) {
    return {
      type: 'tool_calls',
      calls: args.calls,
      content: parsed.content || undefined,
      contentKind: parsed.kind === 'progress' ? 'progress' : undefined,
      diagnostics,
      usage: args.usage,
    }
  }

  return {
    type: 'assistant',
    content: parsed.content,
    kind: parsed.kind,
    diagnostics,
    usage: args.usage,
  }
}

export class GoogleModelAdapter implements ModelAdapter {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly getRuntimeConfig: () => Promise<RuntimeConfig>,
  ) {}

  async next(messages: ChatMessage[], options?: ModelRequestOptions): Promise<AgentStep> {
    const runtime = await this.getRuntimeConfig()
    const payload = convert(messages)
    const max = options?.maxOutputTokens ?? resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )
    const base = runtime.provider.baseUrl.replace(/\/$/, '')
    const streaming = typeof options?.onTextDelta === 'function'
    const url = new URL(
      `${base}/models/${runtime.model.api}:${streaming ? 'streamGenerateContent' : 'generateContent'}`,
    )
    if (streaming) url.searchParams.set('alt', 'sse')

    const body: Record<string, unknown> = {
      contents: payload.contents,
      generationConfig: { maxOutputTokens: max },
    }

    if (payload.system) {
      body.systemInstruction = { parts: [{ text: payload.system }] }
    }

    if (options?.includeTools !== false) {
      body.tools = [{
        functionDeclarations: this.tools.list().map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
      }]
    }

    const response = await post({
      url,
      provider: runtime.provider,
      body: JSON.stringify(body),
      signal: options?.signal,
      gzip: false,
    })

    if (streaming && options?.onTextDelta) return this.stream(response, options.onTextDelta)
    return this.batch(response)
  }

  private async batch(response: Response): Promise<AgentStep> {
    const data = (await readJsonBody(response)) as {
      candidates?: Array<{
        finishReason?: string
        content?: { parts?: Part[] }
      }>
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        cachedContentTokenCount?: number
      }
    }
    const candidate = data.candidates?.[0]
    const text = (candidate?.content?.parts ?? [])
      .flatMap(part => 'text' in part ? [part.text] : [])
      .join('\n')
    const calls = (candidate?.content?.parts ?? []).flatMap((part, idx) => {
      if (!('functionCall' in part)) return []
      return [{
        id: `call-${part.functionCall.name}-${idx}`,
        toolName: part.functionCall.name,
        input: part.functionCall.args ?? {},
      } satisfies ToolCall]
    })

    return step({
      text,
      calls,
      usage: usage(data.usageMetadata),
      reason: candidate?.finishReason,
    })
  }

  private async stream(
    response: Response,
    onDelta: (text: string) => void,
  ): Promise<AgentStep> {
    const body = response.body
    if (!body) throw new Error('Streaming response has no body')

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let reason: string | undefined
    let tok: TokenUsage | undefined
    const calls: ToolCall[] = []

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data: ')) {
            nl = buffer.indexOf('\n')
            continue
          }

          const payload = line.slice(6)
          let event: {
            candidates?: Array<{
              finishReason?: string
              content?: { parts?: Part[] }
            }>
            usageMetadata?: {
              promptTokenCount?: number
              candidatesTokenCount?: number
              cachedContentTokenCount?: number
            }
          }

          try {
            event = JSON.parse(payload) as typeof event
          } catch {
            nl = buffer.indexOf('\n')
            continue
          }

          const candidate = event.candidates?.[0]
          for (const part of candidate?.content?.parts ?? []) {
            if ('text' in part && part.text) {
              text += part.text
              onDelta(part.text)
              continue
            }
            if ('functionCall' in part) {
              calls.push({
                id: `call-${part.functionCall.name}-${calls.length}`,
                toolName: part.functionCall.name,
                input: part.functionCall.args ?? {},
              })
            }
          }

          if (candidate?.finishReason) reason = candidate.finishReason
          if (event.usageMetadata) tok = usage(event.usageMetadata)

          nl = buffer.indexOf('\n')
        }
      }
    } finally {
      reader.releaseLock()
    }

    return step({ text, calls, usage: tok, reason })
  }
}
