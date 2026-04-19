import { gzipSync } from 'node:zlib'
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

type OpenAIMessage = {
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

function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'user') {
      result.push({
        role: message.role,
        content: message.content,
      })
      continue
    }

    if (message.role === 'assistant' || message.role === 'assistant_progress') {
      result.push({
        role: 'assistant',
        content: message.content,
      })
      continue
    }

    if (message.role === 'assistant_tool_call') {
      result.push({
        role: 'assistant',
        tool_calls: [
          {
            id: message.toolUseId,
            type: 'function',
            function: {
              name: message.toolName,
              arguments: JSON.stringify(message.input ?? {}),
            },
          },
        ],
      })
      continue
    }

    result.push({
      role: 'tool',
      tool_call_id: message.toolUseId,
      name: message.toolName,
      content: message.content,
    })
  }

  return result
}

function buildUsage(raw?: {
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

function buildStep(args: {
  text: string
  calls: ToolCall[]
  usage?: TokenUsage
  finishReason?: string
}): AgentStep {
  const parsed = parseAssistantText(args.text)
  const diagnostics: StepDiagnostics = {
    stopReason: args.finishReason,
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
    const maxOutputTokens = options?.maxOutputTokens ?? resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )
    const baseUrl = runtime.provider.baseUrl.replace(/\/$/, '')
    const url = `${baseUrl}/chat/completions`
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
      model: runtime.model.api,
      messages: toOpenAIMessages(messages),
      max_tokens: maxOutputTokens,
      stream: typeof options?.onTextDelta === 'function',
    }

    if (options?.includeTools !== false) {
      requestBody.tools = this.tools.list().map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }))
    }

    const bodyJson = JSON.stringify(requestBody)
    const useGzip = bodyJson.length > 4_096
    const body = useGzip ? gzipSync(bodyJson) : bodyJson
    if (useGzip) {
      headers['content-encoding'] = 'gzip'
    }

    const schedule = exponentialRetrySchedule({
      maxRetries: getRetryLimit(),
      baseDelayMs: 500,
      maxDelayMs: 8_000,
    })

    const response = await withRetry(async () => {
      let response: Response
      try {
        const reqUrl = runtime.provider.auth.type === 'query' && runtime.provider.auth.name
          ? new URL(url)
          : null
        if (reqUrl) {
          reqUrl.searchParams.set(runtime.provider.auth.name ?? 'key', runtime.provider.auth.value)
        }
        response = await fetch(reqUrl?.toString() ?? url, {
          method: 'POST',
          headers,
          body,
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

    if (typeof options?.onTextDelta === 'function') {
      return this.parseStreamingResponse(response, options.onTextDelta)
    }

    return this.parseBatchResponse(response)
  }

  private async parseBatchResponse(response: Response): Promise<AgentStep> {
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

    return buildStep({
      text: choice?.message?.content ?? '',
      calls,
      usage: buildUsage(data.usage),
      finishReason: choice?.finish_reason,
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
    let finishReason: string | undefined
    let usage: TokenUsage | undefined
    const calls = new Map<string, { toolName: string; parts: string[] }>()

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
          if (payload === '[DONE]') {
            newline = buffer.indexOf('\n')
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
            newline = buffer.indexOf('\n')
            continue
          }

          const choice = event.choices?.[0]
          const delta = choice?.delta
          if (typeof delta?.content === 'string' && delta.content.length > 0) {
            text += delta.content
            onTextDelta(delta.content)
          }

          for (const call of delta?.tool_calls ?? []) {
            const id = call.id ?? `tool-${call.index ?? calls.size}`
            const current = calls.get(id) ?? {
              toolName: call.function?.name ?? 'unknown',
              parts: [],
            }
            if (call.function?.name) {
              current.toolName = call.function.name
            }
            if (call.function?.arguments) {
              current.parts.push(call.function.arguments)
            }
            calls.set(id, current)
          }

          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
          }

          if (event.usage) {
            usage = buildUsage(event.usage)
          }

          newline = buffer.indexOf('\n')
        }
      }
    } finally {
      reader.releaseLock()
    }

    return buildStep({
      text,
      calls: [...calls.entries()].map(([id, call]) => {
        try {
          return {
            id,
            toolName: call.toolName,
            input: JSON.parse(call.parts.join('') || '{}'),
          }
        } catch {
          return {
            id,
            toolName: call.toolName,
            input: {},
          }
        }
      }),
      usage,
      finishReason,
    })
  }
}
