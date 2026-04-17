import { afterEach, describe, expect, it, vi } from 'vitest'

const discoverSkills = vi.fn()
const createMcpBackedTools = vi.fn()

vi.mock('../../../src/skills.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/skills.js')>('../../../src/skills.js')
  return {
    ...actual,
    discoverSkills,
  }
})

vi.mock('../../../src/mcp.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/mcp.js')>('../../../src/mcp.js')
  return {
    ...actual,
    createMcpBackedTools,
  }
})

describe('tools/index', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates the default registry with metadata', async () => {
    discoverSkills.mockResolvedValueOnce([
      { name: 'frontend', description: 'Build UI', path: '/tmp', source: 'user' },
    ])
    const { createDefaultToolRegistry } = await import('../../../src/tools/index.js')
    const registry = await createDefaultToolRegistry({ cwd: process.cwd(), runtime: { mcpServers: { fs: { command: 'node' } } } as never })
    expect(registry.list().map((tool) => tool.name)).toContain('read_file')
    expect(registry.getSkills()).toHaveLength(1)
    expect(registry.getMcpServers()).toHaveLength(1)
  })

  it('hydrates MCP tools into the registry', async () => {
    discoverSkills.mockResolvedValueOnce([])
    createMcpBackedTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'mcp__fs__read',
          description: 'read',
          inputSchema: {},
          schema: { safeParse: (input: unknown) => ({ success: true, data: input }) },
          run: vi.fn(async () => ({ ok: true, output: 'ok' })),
        },
      ],
      servers: [{ name: 'fs', command: 'node server.js', status: 'connected', toolCount: 1 }],
      dispose: vi.fn(async () => {}),
    })
    const { createDefaultToolRegistry, hydrateMcpTools } = await import('../../../src/tools/index.js')
    const registry = await createDefaultToolRegistry({ cwd: process.cwd(), runtime: null })
    await hydrateMcpTools({ cwd: process.cwd(), runtime: { mcpServers: {} } as never, tools: registry })
    expect(registry.find('mcp__fs__read')).toBeTruthy()
    expect(registry.getMcpServers()[0]?.name).toBe('fs')
  })
})
