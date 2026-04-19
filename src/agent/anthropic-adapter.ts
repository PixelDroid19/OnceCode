/**
 * Anthropic Messages API adapter.
 *
 * Converts the internal `ChatMessage` format to Anthropic's content-block
 * wire format and handles both batch and SSE streaming responses.
 */

import type { ToolRegistry } from '@/tools/framework.js'
import type { ChatMessage, ModelAdapter, ModelRequestOptions, AgentStep, StepDiagnostics, TokenUsage, ToolCall } from '@/types.js'
import type { RuntimeConfig } from '@/config/runtime.js'
import { resolveMaxOutputTokens } from '@/context/window.js'
import { formatAssistantText, parseAssistantText } from '@/agent/assistant-text.js'
import { readJsonBody } from '@/utils/http.js'
import { post } from '@/agent/request.js'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown }

type Message = {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

function isText(block: ContentBlock): block is Extract<ContentBlock, { type: 'text' }> {
  return block.type === 'text' && typeof block.text === 'string'
}

function isToolUse(block: ContentBlock): block is Extract<ContentBlock, { type: 'tool_use' }> {
  return (
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string'
  )
}

function push(
  messages: Message[],
  role: 'user' | 'assistant',
  block: ContentBlock,
): void {
  const last = messages.at(-1)
  if (last?.role === role) {
    last.content.push(block)
    return
  }
  messages.push({ role, content: [block] })
}

/** Converts internal ChatMessage array to Anthropic's system + messages format. */
function convert(messages: ChatMessage[]): {
  system: string
  messages: Message[]
} {
  const system = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n\n')

  const result: Message[] = []

  for (const msg of messages) {
    if (msg.role === 'system') continue

    if (msg.role === 'user') {
      push(result, 'user', { type: 'text', text: msg.content })
      continue
    }

    if (msg.role === 'assistant' || msg.role === 'assistant_progress') {
      push(result, 'assistant', { type: 'text', text: formatAssistantText(msg) })
      continue
    }

    if (msg.role === 'assistant_tool_call') {
      push(result, 'assistant', {
        type: 'tool_use',
        id: msg.toolUseId,
        name: msg.toolName,
        input: msg.input,
      })
      continue
    }

    push(result, 'user', {
      type: 'tool_result',
      tool_use_id: msg.toolUseId,
      content: msg.content,
      is_error: msg.isError,
    })
  }

  return { system, messages: result }
}

/** Builds a unified AgentStep from Anthropic content blocks. */
function step(
  blocks: ContentBlock[],
  stopReason?: string,
  raw?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  },
): AgentStep {
  const calls: ToolCall[] = []
  const parts: string[] = []
  const types: string[] = []
  const ignored = new Set<string>()

  for (const block of blocks) {
    types.push(block.type)
    if (isText(block)) {
      parts.push(block.text)
      continue
    }
    if (isToolUse(block)) {
      calls.push({ id: block.id, toolName: block.name, input: block.input })
      continue
    }
    ignored.add(block.type)
  }

  const parsed = parseAssistantText(parts.join('\n').trim())
  const diagnostics: StepDiagnostics = {
    stopReason,
    blockTypes: types,
    ignoredBlockTypes: [...ignored],
  }

  const usage: TokenUsage | undefined = raw
    ? {
        inputTokens: raw.input_tokens ?? 0,
        outputTokens: raw.output_tokens ?? 0,
        cacheCreationInputTokens: raw.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: raw.cache_read_input_tokens ?? 0,
      }
    : undefined

  if (calls.length > 0) {
    return {
      type: 'tool_calls',
      calls,
      content: parsed.content || undefined,
      contentKind: parsed.kind === 'progress' ? 'progress' : undefined,
      diagnostics,
      usage,
    }
  }

  return {
    type: 'assistant',
    content: parsed.content,
    kind: parsed.kind,
    diagnostics,
    usage,
  }
}

export class AnthropicModelAdapter implements ModelAdapter {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly getRuntimeConfig: () => Promise<RuntimeConfig>,
  ) {}

  async next(messages: ChatMessage[], options?: ModelRequestOptions) {
    const runtime = await this.getRuntimeConfig()
    const payload = convert(messages)
    const url = `${runtime.provider.baseUrl.replace(/\/$/, '')}/v1/messages`
    const max = options?.maxOutputTokens ?? resolveMaxOutputTokens(
      runtime.model,
      runtime.maxOutputTokens,
    )

    const body: Record<string, unknown> = {
      model: runtime.model.api,
      system: payload.system,
      messages: payload.messages,
      max_tokens: max,
    }

    if (options?.includeTools !== false) {
      body.tools = this.tools.list().map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }))
    }

    const streaming = typeof options?.onTextDelta === 'function'
    if (streaming) body.stream = true

    const response = await post({
      url,
      provider: runtime.provider,
      body: JSON.stringify(body),
      extra: { 'anthropic-version': '2023-06-01' },
      signal: options?.signal,
    })

    if (streaming) return this.stream(response, options!.onTextDelta!)
    return this.batch(response)
  }

  private async batch(response: Response): Promise<AgentStep> {
    const data = (await readJsonBody(response)) as {
      stop_reason?: string
      content?: ContentBlock[]
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
    }
    return step(data.content ?? [], data.stop_reason, data.usage)
  }

  private async stream(
    response: Response,
    onDelta: (text: string) => void,
  ): Promise<AgentStep> {
    const body = response.body
    if (!body) throw new Error('Streaming response has no body')

    const blocks: ContentBlock[] = []
    let idx = -1
    let chunks: string[] = []
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

        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)

          if (!line.startsWith('data: ')) continue
          const json = line.slice(6)
          if (json === '[DONE]') continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(json) as Record<string, unknown>
          } catch {
            continue
          }

          const type = event.type as string

          if (type === 'content_block_start') {
            idx = (event.index as number) ?? blocks.length
            blocks[idx] = event.content_block as ContentBlock
            chunks = []
          }

          if (type === 'content_block_delta') {
            const delta = event.delta as Record<string, unknown>
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              onDelta(delta.text)
              const block = blocks[idx]
              if (block && 'text' in block) {
                (block as { text: string }).text += delta.text
              }
            }
            if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              chunks.push(delta.partial_json)
            }
          }

          if (type === 'content_block_stop') {
            if (chunks.length > 0 && blocks[idx]) {
              const block = blocks[idx]
              if (block.type === 'tool_use') {
                try {
                  (block as { input: unknown }).input = JSON.parse(chunks.join(''))
                } catch {
                  (block as { input: unknown }).input = {}
                }
              }
            }
            chunks = []
          }

          if (type === 'message_start') {
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

          if (type === 'message_delta') {
            const delta = event.delta as Record<string, unknown> | undefined
            if (delta?.stop_reason) stopReason = delta.stop_reason as string
            const du = event.usage as Record<string, number> | undefined
            if (du && usage) usage.outputTokens = du.output_tokens ?? usage.outputTokens
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return step(blocks, stopReason, usage ? {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: usage.cacheCreationInputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens,
    } : undefined)
  }
}
