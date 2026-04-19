/**
 * OpenAI Chat Completions API adapter.
 *
 * Converts the internal `ChatMessage` format to OpenAI's message/tool_calls
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

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_call_id?: string
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

/** Converts internal ChatMessage array to OpenAI's message format. */
function convert(messages: ChatMessage[]): Message[] {
  const result: Message[] = []

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'user') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }

    if (msg.role === 'assistant' || msg.role === 'assistant_progress') {
      result.push({ role: 'assistant', content: msg.content })
      continue
    }

    if (msg.role === 'assistant_tool_call') {
      result.push({
        role: 'assistant',
        tool_calls: [{
          id: msg.toolUseId,
          type: 'function',
          function: {
            name: msg.toolName,
            arguments: JSON.stringify(msg.input ?? {}),
          },
        }],
      })
      continue
    }

    result.push({
      role: 'tool',
      tool_call_id: msg.toolUseId,
      name: msg.toolName,
      content: msg.content,
    })
  }

  return result
}

function usage(raw?: {
  prompt_tokens?: number
  completion_tokens?: number
}): TokenUsage | undefined {
  if (!raw) return undefined
  return {
    inputTokens: raw.prompt_tokens ?? 0,
    outputTokens: raw.completion_tokens ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }
}

/** Builds a unified AgentStep from parsed OpenAI response data. */
function step(args: {
  text: string
  calls: ToolCall[]
  usage?: TokenUsage
  reason?: string
}): AgentStep {
  const parsed = parseAssistantText(args.text)
  const diagnostics: StepDiagnostics = {
    stopReason: args.reason,
    blockTypes: args.calls.length > 0 ? ['text', 'tool_calls'] : ['text'],
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

export class OpenAIModelAdapter implements ModelAdapter {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly getRuntimeConfig: () => Promise<RuntimeConfig>,
  ) {}

  async next(messages: ChatMessage[], options?: ModelRequestOptions): Promise<AgentStep> {
    const runtime = await this.getRuntimeConfig()
    const max = options?.maxOutputTokens ?? resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )
    const url = `${runtime.provider.baseUrl.replace(/\/$/, '')}/chat/completions`
    const streaming = typeof options?.onTextDelta === 'function'

    const body: Record<string, unknown> = {
      model: runtime.model.api,
      messages: convert(messages),
      max_tokens: max,
      stream: streaming,
    }

    if (options?.includeTools !== false) {
      body.tools = this.tools.list().map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }))
    }

    const response = await post({
      url,
      provider: runtime.provider,
      body: JSON.stringify(body),
      signal: options?.signal,
    })

    if (streaming) return this.stream(response, options!.onTextDelta!)
    return this.batch(response)
  }

  private async batch(response: Response): Promise<AgentStep> {
    const data = (await readJsonBody(response)) as {
      choices?: Array<{
        finish_reason?: string
        message?: {
          content?: string | null
          tool_calls?: Array<{
            id?: string
            function?: {
              name?: string
              arguments?: string
            }
          }>
        }
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
      }
    }
    const choice = data.choices?.[0]
    const calls = (choice?.message?.tool_calls ?? []).flatMap(call => {
      if (!call.id || !call.function?.name) return []
      try {
        return [{
          id: call.id,
          toolName: call.function.name,
          input: JSON.parse(call.function.arguments ?? '{}'),
        } satisfies ToolCall]
      } catch {
        return [{
          id: call.id,
          toolName: call.function.name,
          input: {},
        } satisfies ToolCall]
      }
    })

    return step({
      text: choice?.message?.content ?? '',
      calls,
      usage: usage(data.usage),
      reason: choice?.finish_reason,
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
    const calls = new Map<string, { toolName: string; parts: string[] }>()

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
          if (payload === '[DONE]') {
            nl = buffer.indexOf('\n')
            continue
          }

          let event: {
            choices?: Array<{
              finish_reason?: string | null
              delta?: {
                content?: string
                tool_calls?: Array<{
                  id?: string
                  index?: number
                  function?: {
                    name?: string
                    arguments?: string
                  }
                }>
              }
            }>
            usage?: {
              prompt_tokens?: number
              completion_tokens?: number
            }
          }

          try {
            event = JSON.parse(payload) as typeof event
          } catch {
            nl = buffer.indexOf('\n')
            continue
          }

          const choice = event.choices?.[0]
          const delta = choice?.delta
          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            text += delta.content
            onDelta(delta.content)
          }

          for (const call of delta?.tool_calls ?? []) {
            const id = call.id ?? `tool-${call.index ?? calls.size}`
            const current = calls.get(id) ?? { toolName: call.function?.name ?? 'unknown', parts: [] }
            if (call.function?.name) current.toolName = call.function.name
            if (call.function?.arguments) current.parts.push(call.function.arguments)
            calls.set(id, current)
          }

          if (choice?.finish_reason) reason = choice.finish_reason
          if (event.usage) tok = usage(event.usage)

          nl = buffer.indexOf('\n')
        }
      }
    } finally {
      reader.releaseLock()
    }

    return step({
      text,
      calls: [...calls.entries()].map(([id, call]) => {
        try {
          return { id, toolName: call.toolName, input: JSON.parse(call.parts.join('') || '{}') }
        } catch {
          return { id, toolName: call.toolName, input: {} }
        }
      }),
      usage: tok,
      reason,
    })
  }
}
