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
import {
  extractErrorMessage,
  parseRetryAfterMs,
  readJsonBody,
} from '@/utils/http.js'
import {
  AuthError,
  NetworkError,
  RateLimitError,
  UnknownError,
  exponentialRetrySchedule,
  withRetry,
} from '@/utils/result.js'
import { resolveMaxOutputTokens } from '@/context/window.js'

const DEFAULT_MAX_RETRIES = 4

type GooglePart =
  | { text: string }
  | { functionCall: { name: string; args?: unknown } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type GoogleMessage = {
  role: 'user' | 'model'
  parts: GooglePart[]
}

function getRetryLimit(): number {
  const value = Number(process.env.ONCECODE_MAX_RETRIES)
  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_MAX_RETRIES
  }
  return Math.floor(value)
}

function toRequestError(args: {
  status?: number
  message: string
  retryAfterMs?: number | null
}): Error {
  if (args.status === 401 || args.status === 403) {
    return new AuthError(args.message)
  }
  if (args.status === 429) {
    return new RateLimitError(args.message, args.retryAfterMs ?? undefined)
  }
  if (args.status !== undefined && args.status >= 500 && args.status < 600) {
    return new NetworkError(args.message)
  }
  return new UnknownError(args.message)
}

function buildUsage(raw?: {
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

function toGoogleMessages(messages: ChatMessage[]): {
  system: string
  contents: GoogleMessage[]
} {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')
  const contents: GoogleMessage[] = []

  const push = (role: 'user' | 'model', part: GooglePart) => {
    const last = contents.at(-1)
    if (last?.role === role) {
      last.parts.push(part)
      return
    }
    contents.push({ role, parts: [part] })
  }

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      push('user', { text: message.content })
      continue
    }

    if (message.role === 'assistant' || message.role === 'assistant_progress') {
      push('model', { text: message.content })
      continue
    }

    if (message.role === 'assistant_tool_call') {
      push('model', {
        functionCall: {
          name: message.toolName,
          args: message.input,
        },
      })
      continue
    }

    push('user', {
      functionResponse: {
        name: message.toolName,
        response: {
          content: message.content,
          is_error: message.isError,
        },
      },
    })
  }

  return { system, contents }
}

function buildStep(args: {
  text: string
  calls: ToolCall[]
  usage?: TokenUsage
  stopReason?: string
}): AgentStep {
  const parsed = parseAssistantText(args.text)
  const diagnostics: StepDiagnostics = {
    stopReason: args.stopReason,
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
    const payload = toGoogleMessages(messages)
    const maxOutputTokens = options?.maxOutputTokens ?? resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )
    const baseUrl = runtime.provider.baseUrl.replace(/\/$/, '')
    const stream = typeof options?.onTextDelta === 'function'
    const url = new URL(
      `${baseUrl}/models/${runtime.model.api}:${stream ? 'streamGenerateContent' : 'generateContent'}`,
    )
    if (stream) {
      url.searchParams.set('alt', 'sse')
    }
    if (runtime.provider.auth.type === 'query' && runtime.provider.auth.name) {
      url.searchParams.set(runtime.provider.auth.name, runtime.provider.auth.value)
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }

    if (runtime.provider.auth.type === 'bearer') {
      headers.Authorization = `Bearer ${runtime.provider.auth.value}`
    }

    if (runtime.provider.auth.type === 'header' && runtime.provider.auth.name) {
      headers[runtime.provider.auth.name] = runtime.provider.auth.value
    }

    const requestBody: Record<string, unknown> = {
      contents: payload.contents,
      generationConfig: {
        maxOutputTokens,
      },
    }

    if (payload.system) {
      requestBody.systemInstruction = {
        parts: [{ text: payload.system }],
      }
    }

    if (options?.includeTools !== false) {
      requestBody.tools = [
        {
          functionDeclarations: this.tools.list().map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
        },
      ]
    }

    const schedule = exponentialRetrySchedule({
      maxRetries: getRetryLimit(),
      baseDelayMs: 500,
      maxDelayMs: 8_000,
    })

    const response = await withRetry(async () => {
      let response: Response
      try {
        response = await fetch(url.toString(), {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: options?.signal,
        })
      } catch (error) {
        if (error instanceof Error) {
          throw new NetworkError(error.message)
        }
        throw new UnknownError(error)
      }

      if (response.ok) {
        return response
      }

      const data = await readJsonBody(response)
      throw toRequestError({
        status: response.status,
        message: extractErrorMessage(data, response.status),
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      })
    }, schedule)

    if (stream && options?.onTextDelta) {
      return this.parseStreamingResponse(response, options.onTextDelta)
    }

    return this.parseBatchResponse(response)
  }

  private async parseBatchResponse(response: Response): Promise<AgentStep> {
    const data = (await readJsonBody(response)) as {
      candidates?: Array<{
        finishReason?: string
        content?: {
          parts?: GooglePart[]
        }
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
    const calls = (candidate?.content?.parts ?? []).flatMap(part => {
      if (!('functionCall' in part)) return []
      return [{
        id: `call-${part.functionCall.name}`,
        toolName: part.functionCall.name,
        input: part.functionCall.args ?? {},
      } satisfies ToolCall]
    })

    return buildStep({
      text,
      calls,
      usage: buildUsage(data.usageMetadata),
      stopReason: candidate?.finishReason,
    })
  }

  private async parseStreamingResponse(
    response: Response,
    onTextDelta: (text: string) => void,
  ): Promise<AgentStep> {
    const body = response.body
    if (!body) {
      throw new Error('Streaming response has no body')
    }

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let stopReason: string | undefined
    let usage: TokenUsage | undefined
    const calls: ToolCall[] = []

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data: ')) {
            newline = buffer.indexOf('\n')
            continue
          }

          const payload = line.slice(6)
          let event: {
            candidates?: Array<{
              finishReason?: string
              content?: {
                parts?: GooglePart[]
              }
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
            newline = buffer.indexOf('\n')
            continue
          }

          const candidate = event.candidates?.[0]
          for (const part of candidate?.content?.parts ?? []) {
            if ('text' in part && part.text) {
              text += part.text
              onTextDelta(part.text)
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

          if (candidate?.finishReason) {
            stopReason = candidate.finishReason
          }

          if (event.usageMetadata) {
            usage = buildUsage(event.usageMetadata)
          }

          newline = buffer.indexOf('\n')
        }
      }
    } finally {
      reader.releaseLock()
    }

    return buildStep({
      text,
      calls,
      usage,
      stopReason,
    })
  }
}
