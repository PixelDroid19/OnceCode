import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AnthropicModelAdapter } from '../../src/anthropic-adapter.js'
import { ToolRegistry } from '../../src/tool.js'

describe('anthropic-adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
      model: 'claude-3-5-sonnet',
      baseUrl: 'https://api.example.com',
      authToken: 'token',
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
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
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

    const sleepSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...args: unknown[]) => void) => {
      fn()
      return 0 as unknown as ReturnType<typeof setTimeout>
    }) as typeof setTimeout)

    const step = await adapter.next([{ role: 'user', content: 'hello' }])
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
    expect(sleepSpy).toHaveBeenCalled()
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
})
