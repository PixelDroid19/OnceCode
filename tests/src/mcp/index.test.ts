import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { setEnv } from '../helpers/env.js'
import { importFresh } from '../helpers/module.js'

describe('mcp', () => {
  let homeDir = ''

  afterEach(async () => {
    vi.restoreAllMocks()
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('creates streamable-http MCP tools and helper tools from public protocol responses', async () => {
    homeDir = await makeTempDir('oncecode-home')
    setEnv({ HOME: homeDir })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; id?: number }
      const resultByMethod: Record<string, unknown> = {
        initialize: {},
        'tools/list': {
          tools: [
            {
              name: 'search',
              description: 'Search docs',
              inputSchema: { type: 'object' },
            },
          ],
        },
        'resources/list': {
          resources: [{ uri: 'file:///doc', name: 'doc' }],
        },
        'prompts/list': {
          prompts: [{ name: 'prompt1', arguments: [{ name: 'topic', required: true }] }],
        },
        'tools/call': {
          content: [{ type: 'text', text: 'search output' }],
        },
        'resources/read': {
          contents: [{ uri: 'file:///doc', text: 'resource content' }],
        },
        'prompts/get': {
          messages: [{ role: 'user', content: 'prompt body' }],
        },
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: resultByMethod[body.method ?? ''] ?? {} }),
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    const { createMcpBackedTools } = await importFresh<typeof import('@/mcp/registry.js')>(
      '@/mcp/registry.js', import.meta.url,
    )
    const result = await createMcpBackedTools({
      cwd: process.cwd(),
      mcpServers: {
        docs: {
          protocol: 'streamable-http',
          url: 'https://example.com/mcp',
          command: '',
        },
      },
    })

    expect(result.servers).toEqual([
      expect.objectContaining({ name: 'docs', status: 'connected', toolCount: 1, resourceCount: 1, promptCount: 1 }),
    ])
    expect(result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'mcp__docs__search',
        'list_mcp_resources',
        'read_mcp_resource',
        'list_mcp_prompts',
        'get_mcp_prompt',
      ]),
    )

    const wrapped = result.tools.find((tool) => tool.name === 'mcp__docs__search')!
    await expect(wrapped.run({}, { cwd: process.cwd() })).resolves.toEqual({ ok: true, output: 'search output' })
    await result.dispose()
  })
})
