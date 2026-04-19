import type { ToolRegistry } from '@/tools/framework.js'
import type { ChatMessage, ModelAdapter, ModelRequestOptions, AgentStep, StepDiagnostics, TokenUsage, ToolCall } from '@/types.js'
import type { RuntimeConfig } from '@/config/runtime.js'
import { resolveMaxOutputTokens } from '@/context/window.js'
import { formatAssistantText, parseAssistantText } from '@/agent/assistant-text.js'
import {
  extractErrorMessage,
  parseRetryAfterMs,
  readJsonBody,
} from '@/utils/http.js'
import { gzipSync } from 'node:zlib'
import {
  AuthError,
  NetworkError,
  RateLimitError,
  UnknownError,
  exponentialRetrySchedule,
  withRetry,
} from '@/utils/result.js'

function getBaseUrl(runtime: RuntimeConfig): string {
  return runtime.provider?.baseUrl ?? (runtime as RuntimeConfig & { baseUrl?: string }).baseUrl ?? 'https://api.anthropic.com'
}

function getAuth(runtime: RuntimeConfig): { type: 'bearer' | 'header'; value: string; name?: string } | null {
  if (runtime.provider?.auth) {
    if (runtime.provider.auth.type === 'query') {
      return null
    }
    return {
      type: runtime.provider.auth.type,
      value: runtime.provider.auth.value,
      name: runtime.provider.auth.name,
    }
  }

  const legacy = runtime as RuntimeConfig & {
    authToken?: string
    apiKey?: string
  }
  if (legacy.authToken) {
    return {
      type: 'bearer',
      value: legacy.authToken,
    }
  }
  if (legacy.apiKey) {
    return {
      type: 'header',
      name: 'x-api-key',
      value: legacy.apiKey,
    }
  }
  return null
}

const DEFAULT_MAX_RETRIES = 4

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown }

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
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

function isTextBlock(block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, {
  type: 'text'
}> {
  return block.type === 'text' && typeof block.text === 'string'
}

function isToolUseBlock(block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, {
  type: 'tool_use'
}> {
  return (
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  )
}

function toTextBlock(text: string): AnthropicContentBlock {
  return { type: 'text', text }
}

function toAssistantText(message: Extract<ChatMessage, {
  role: 'assistant' | 'assistant_progress'
}>): string {
  return formatAssistantText(message)
}

function pushAnthropicMessage(
  messages: AnthropicMessage[],
  role: 'user' | 'assistant',
  block: AnthropicContentBlock,
): void {
  const last = messages.at(-1)
  if (last?.role === role) {
    last.content.push(block)
    return
  }

  messages.push({ role, content: [block] })
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const system = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .join('\n\n')

  const converted: AnthropicMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      pushAnthropicMessage(converted, 'user', toTextBlock(message.content))
      continue
    }

    if (message.role === 'assistant' || message.role === 'assistant_progress') {
      pushAnthropicMessage(
        converted,
        'assistant',
        toTextBlock(toAssistantText(message)),
      )
      continue
    }

    if (message.role === 'assistant_tool_call') {
      pushAnthropicMessage(converted, 'assistant', {
        type: 'tool_use',
        id: message.toolUseId,
        name: message.toolName,
        input: message.input,
      })
      continue
    }

    pushAnthropicMessage(converted, 'user', {
      type: 'tool_result',
      tool_use_id: message.toolUseId,
      content: message.content,
      is_error: message.isError,
    })
  }

  return { system, messages: converted }
}

export class AnthropicModelAdapter implements ModelAdapter {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly getRuntimeConfig: () => Promise<RuntimeConfig>,
  ) {}

  async next(messages: ChatMessage[], options?: ModelRequestOptions) {
    const runtime = await this.getRuntimeConfig()
    const payload = toAnthropicMessages(messages)
    const url = `${getBaseUrl(runtime).replace(/\/$/, '')}/v1/messages`
    const maxOutputTokens = options?.maxOutputTokens ?? resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    }

    const auth = getAuth(runtime)
    if (auth?.type === 'bearer') {
      headers.Authorization = `Bearer ${auth.value}`
    }

    if (auth?.type === 'header' && auth.name) {
      headers[auth.name] = auth.value
    }

    const includeTools = options?.includeTools !== false
    const requestBody: Record<string, unknown> = {
      model: runtime.model.api,
      system: payload.system,
      messages: payload.messages,
      max_tokens: maxOutputTokens,
    }

    if (includeTools) {
      requestBody.tools = this.tools.list().map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }))
    }

    // Use SSE streaming when a text delta callback is provided
    const useStreaming = typeof options?.onTextDelta === 'function'
    if (useStreaming) {
      requestBody.stream = true
    }

    const bodyJson = JSON.stringify(requestBody)
    const useGzip = bodyJson.length > 4_096
    const bodyPayload = useGzip ? gzipSync(bodyJson) : bodyJson

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
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: bodyPayload,
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
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
      throw toRequestError({
        status: response.status,
        message: extractErrorMessage(data, response.status),
        retryAfterMs,
      })
    }, schedule)

    if (!response.ok) {
      const data = await readJsonBody(response)
      throw new Error(extractErrorMessage(data, response.status))
    }

    if (useStreaming) {
      return this.parseStreamingResponse(response, options!.onTextDelta!)
    }

    return this.parseBatchResponse(response)
  }

  private async parseBatchResponse(response: Response): Promise<AgentStep> {
    const data = (await readJsonBody(response)) as {
      stop_reason?: string
      content?: AnthropicContentBlock[]
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
    }

    return buildAgentStep(data.content ?? [], data.stop_reason, data.usage)
  }

  private async parseStreamingResponse(
    response: Response,
    onTextDelta: (text: string) => void,
  ): Promise<AgentStep> {
    const body = response.body
    if (!body) {
      throw new Error('Streaming response has no body')
    }

    const blocks: AnthropicContentBlock[] = []
    let currentBlockIndex = -1
    let currentToolJsonChunks: string[] = []
    let stopReason: string | undefined
    let usage: TokenUsage | undefined

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE lines
        let newlineIdx: number
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)

          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6)
          if (jsonStr === '[DONE]') continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(jsonStr) as Record<string, unknown>
          } catch {
            continue
          }

          const eventType = event.type as string

          if (eventType === 'content_block_start') {
            currentBlockIndex = (event.index as number) ?? blocks.length
            const block = event.content_block as AnthropicContentBlock
            blocks[currentBlockIndex] = block
            currentToolJsonChunks = []
          }

          if (eventType === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown>
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              onTextDelta(delta.text)
              // Accumulate text in the block
              const textBlock = blocks[currentBlockIndex]
              if (textBlock && 'text' in textBlock) {
                (textBlock as { text: string }).text += delta.text
              }
            }
            if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              currentToolJsonChunks.push(delta.partial_json)
            }
          }

          if (eventType === 'content_block_stop') {
            // Finalize tool use input from accumulated JSON chunks
            if (currentToolJsonChunks.length > 0 && blocks[currentBlockIndex]) {
              const block = blocks[currentBlockIndex]
              if (block.type === 'tool_use') {
                try {
                  (block as { input: unknown }).input = JSON.parse(currentToolJsonChunks.join(''))
                } catch {
                  (block as { input: unknown }).input = {}
                }
              }
            }
            currentToolJsonChunks = []
          }

          if (eventType === 'message_start') {
            const msg = event.message as Record<string, unknown> | undefined
            if (msg?.usage) {
              const u = msg.usage as Record<string, number>
              usage = {
                inputTokens: u.input_tokens ?? 0,
                outputTokens: u.output_tokens ?? 0,
                cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
                cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
              }
            }
          }

          if (eventType === 'message_delta') {
            const delta = event.delta as Record<string, unknown> | undefined
            if (delta?.stop_reason) {
              stopReason = delta.stop_reason as string
            }
            const deltaUsage = event.usage as Record<string, number> | undefined
            if (deltaUsage && usage) {
              usage.outputTokens = deltaUsage.output_tokens ?? usage.outputTokens
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return buildAgentStep(blocks, stopReason, usage ? {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
    } : undefined)
  }
}

// ── Shared step builder ──────────────────────────────────────────

function buildAgentStep(
  blocks: AnthropicContentBlock[],
  stopReason?: string,
  rawUsage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  },
): AgentStep {
  const toolCalls: ToolCall[] = []
  const textParts: string[] = []
  const blockTypes: string[] = []
  const ignoredBlockTypes = new Set<string>()

  for (const block of blocks) {
    blockTypes.push(block.type)

    if (isTextBlock(block)) {
      textParts.push(block.text)
      continue
    }

    if (isToolUseBlock(block)) {
      toolCalls.push({
        id: block.id,
        toolName: block.name,
        input: block.input,
      })
      continue
    }

    ignoredBlockTypes.add(block.type)
  }

  const parsedText = parseAssistantText(textParts.join('\n').trim())
  const diagnostics: StepDiagnostics = {
    stopReason,
    blockTypes,
    ignoredBlockTypes: [...ignoredBlockTypes],
  }

  const usage: TokenUsage | undefined = rawUsage
    ? {
        inputTokens: rawUsage.input_tokens ?? 0,
        outputTokens: rawUsage.output_tokens ?? 0,
        cacheCreationInputTokens: rawUsage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: rawUsage.cache_read_input_tokens ?? 0,
      }
    : undefined

  if (toolCalls.length > 0) {
    return {
      type: 'tool_calls' as const,
      calls: toolCalls,
      content: parsedText.content || undefined,
      contentKind:
        parsedText.kind === 'progress'
          ? ('progress' as const)
          : undefined,
      diagnostics,
      usage,
    }
  }

  return {
    type: 'assistant' as const,
    content: parsedText.content,
    kind: parsedText.kind,
    diagnostics,
    usage,
  }
}
