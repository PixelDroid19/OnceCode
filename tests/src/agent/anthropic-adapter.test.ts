import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AnthropicModelAdapter } from '@/agent/anthropic-adapter.js'
import { ToolRegistry } from '@/tools/framework.js'

describe('anthropic-adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete process.env.ONCECODE_MAX_RETRIES
  })

  function createAdapter() {
    const tools = new ToolRegistry([
      {
        name: 'read_file',
        description: 'read file',
        inputSchema: { type: 'object' },
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'ok' })),
      },
    ])

    return new AnthropicModelAdapter(tools, async () => ({
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        transport: 'anthropic',
        baseUrl: 'https://api.example.com',
        auth: {
          env: 'ANTHROPIC_AUTH_TOKEN',
          type: 'bearer',
          value: 'token',
        },
      },
      model: {
        id: 'claude-3-5-sonnet',
        ref: 'anthropic:claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        api: 'claude-3-5-sonnet',
        providerId: 'anthropic',
        aliases: [],
        defaultOutput: 8_192,
        limits: { context: 200_000, output: 8_192 },
        capabilities: {
          attachment: true,
          reasoning: true,
          temperature: true,
          toolCall: true,
          interleaved: false,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
        },
        known: true,
      },
      modelRef: 'anthropic:claude-3-5-sonnet',
      maxOutputTokens: 999999,
      mcpServers: {},
      sourceSummary: 'test',
    }))
  }

  it('returns tool calls and parses progress text markers', async () => {
    const adapter = createAdapter()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: '<progress>thinking</progress>' },
            { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'README.md' } },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const step = await adapter.next([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'read it' },
    ])

    expect(step).toMatchObject({
      type: 'tool_calls',
      content: 'thinking',
      contentKind: 'progress',
      calls: [{ id: 'call-1', toolName: 'read_file', input: { path: 'README.md' } }],
      diagnostics: { stopReason: 'tool_use', blockTypes: ['text', 'tool_use'] },
    })

    const init = fetchSpy.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body ?? '{}')) as { max_tokens?: number; tools?: unknown[] }
    expect(body.max_tokens).toBe(8192)
    expect(body.tools).toHaveLength(1)
  })

  it('retries retryable failures and returns assistant final text', async () => {
    const adapter = createAdapter()
    process.env.ONCECODE_MAX_RETRIES = '1'
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'busy' } }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'content-type': 'application/json', 'retry-after': '1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '<final>done</final>' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    vi.useFakeTimers()
    const promise = adapter.next([{ role: 'user', content: 'hello' }])
    await vi.advanceTimersByTimeAsync(1_100)

    const step = await promise
    expect(step).toEqual({
      type: 'assistant',
      content: 'done',
      kind: 'final',
      diagnostics: {
        stopReason: 'end_turn',
        blockTypes: ['text'],
        ignoredBlockTypes: [],
      },
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('surfaces structured api errors', async () => {
    const adapter = createAdapter()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'bad auth' } }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(adapter.next([{ role: 'user', content: 'hello' }])).rejects.toThrow('bad auth')
  })

  it('parses SSE streaming text deltas and tool calls', async () => {
    const adapter = createAdapter()
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"<progress>hel"}}\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo</progress>"}}\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"read_file","input":{}}}\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"README.md\\"}"}}\n',
      'data: {"type":"content_block_stop","index":1}\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}\n',
    ].join('')
    const onTextDelta = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(chunks, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    const step = await adapter.next([{ role: 'user', content: 'read it' }], {
      onTextDelta,
    })

    expect(onTextDelta).toHaveBeenCalledWith('<progress>hel')
    expect(onTextDelta).toHaveBeenCalledWith('lo</progress>')
    expect(step).toMatchObject({
      type: 'tool_calls',
      content: 'hello',
      contentKind: 'progress',
      calls: [{ id: 'call-1', toolName: 'read_file', input: { path: 'README.md' } }],
    })
  })
})
