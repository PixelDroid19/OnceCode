import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '@/tools/framework.js'
import * as fileIndex from '@/tools/file-index.js'

describe('tool registry', () => {
  it('lists and finds tools', () => {
    const registry = new ToolRegistry([
      {
        name: 'demo',
        description: 'demo tool',
        inputSchema: {},
        schema: z.object({ value: z.string() }),
        run: vi.fn(),
      },
    ])

    expect(registry.list()).toHaveLength(1)
    expect(registry.find('demo')?.description).toBe('demo tool')
  })

  it('executes validated tools', async () => {
    const run = vi.fn(async () => ({ ok: true, output: 'ok' }))
    const registry = new ToolRegistry([
      {
        name: 'demo',
        description: 'demo tool',
        inputSchema: {},
        schema: z.object({ value: z.string() }),
        run,
      },
    ])

    await expect(
      registry.execute('demo', { value: 'x' }, { cwd: process.cwd() }),
    ).resolves.toEqual({ ok: true, output: 'ok' })
    expect(run).toHaveBeenCalledWith({ value: 'x' }, { cwd: process.cwd() })
  })

  it('returns validation errors and unknown tool errors', async () => {
    const registry = new ToolRegistry([
      {
        name: 'demo',
        description: 'demo tool',
        inputSchema: {},
        schema: z.object({ value: z.string() }),
        run: vi.fn(async () => ({ ok: true, output: 'ok' })),
      },
    ])

    await expect(registry.execute('missing', {}, { cwd: process.cwd() })).resolves.toEqual({
      ok: false,
      output: 'Unknown tool: missing',
    })
    const invalid = await registry.execute('demo', { value: 1 }, { cwd: process.cwd() })
    expect(invalid.ok).toBe(false)
    expect(invalid.output.length).toBeGreaterThan(0)
  })

  it('adds tools and disposers safely', async () => {
    const dispose = vi.fn(async () => {})
    const registry = new ToolRegistry([], {}, dispose)
    registry.addTools([
      {
        name: 'demo',
        description: 'demo',
        inputSchema: {},
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'ok' })),
      },
      {
        name: 'demo',
        description: 'duplicate',
        inputSchema: {},
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'ok' })),
      },
    ])
    expect(registry.list()).toHaveLength(1)
    await registry.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('caches successful read-only tool results for a short period', async () => {
    const run = vi.fn(async () => ({ ok: true, output: 'cached result' }))
    const registry = new ToolRegistry([
      {
        name: 'read_file',
        description: 'read tool',
        inputSchema: {},
        schema: z.object({ path: z.string() }),
        run,
      },
    ])

    const first = await registry.execute('read_file', { path: 'a.ts' }, { cwd: process.cwd() })
    const second = await registry.execute('read_file', { path: 'a.ts' }, { cwd: process.cwd() })

    expect(first).toEqual({ ok: true, output: 'cached result' })
    expect(second).toEqual({ ok: true, output: 'cached result' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not cache mutating tools', async () => {
    const run = vi.fn(async () => ({ ok: true, output: 'mutated' }))
    const registry = new ToolRegistry([
      {
        name: 'write_file',
        description: 'write tool',
        inputSchema: {},
        schema: z.object({ path: z.string() }),
        run,
      },
    ])

    await registry.execute('write_file', { path: 'a.ts' }, { cwd: process.cwd() })
    await registry.execute('write_file', { path: 'a.ts' }, { cwd: process.cwd() })

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('invalidates read-only cache when a mutating tool runs', async () => {
    let readCallCount = 0
    const readRun = vi.fn(async () => ({ ok: true, output: `read-${++readCallCount}` }))
    const writeRun = vi.fn(async () => ({ ok: true, output: 'written' }))
    const registry = new ToolRegistry([
      {
        name: 'read_file',
        description: 'read tool',
        inputSchema: {},
        schema: z.object({ path: z.string() }),
        run: readRun,
      },
      {
        name: 'edit_file',
        description: 'edit tool',
        inputSchema: {},
        schema: z.object({ path: z.string() }),
        run: writeRun,
      },
    ])

    const cwd = process.cwd()
    const first = await registry.execute('read_file', { path: 'a.ts' }, { cwd })
    expect(first.output).toBe('read-1')

    // cached — should not call run again
    const second = await registry.execute('read_file', { path: 'a.ts' }, { cwd })
    expect(second.output).toBe('read-1')
    expect(readRun).toHaveBeenCalledTimes(1)

    // mutating tool invalidates the cache
    await registry.execute('edit_file', { path: 'a.ts' }, { cwd })

    // read_file should call run again since cache was cleared
    const third = await registry.execute('read_file', { path: 'a.ts' }, { cwd })
    expect(third.output).toBe('read-2')
    expect(readRun).toHaveBeenCalledTimes(2)
  })

  it('invalidates file index cache when a mutating tool runs', async () => {
    const clearSpy = vi.spyOn(fileIndex, 'clearFileIndexCache')
    const writeRun = vi.fn(async () => ({ ok: true, output: 'written' }))
    const registry = new ToolRegistry([
      {
        name: 'write_file',
        description: 'write tool',
        inputSchema: {},
        schema: z.object({ path: z.string() }),
        run: writeRun,
      },
    ])

    await registry.execute('write_file', { path: 'b.ts' }, { cwd: process.cwd() })
    expect(clearSpy).toHaveBeenCalledTimes(1)
    clearSpy.mockRestore()
  })

  it('does not invalidate caches when a read-only tool runs', async () => {
    const clearSpy = vi.spyOn(fileIndex, 'clearFileIndexCache')
    const readRun = vi.fn(async () => ({ ok: true, output: 'content' }))
    const registry = new ToolRegistry([
      {
        name: 'list_files',
        description: 'list tool',
        inputSchema: {},
        schema: z.object({ dir: z.string() }),
        run: readRun,
      },
    ])

    await registry.execute('list_files', { dir: '.' }, { cwd: process.cwd() })
    expect(clearSpy).not.toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('does not invalidate caches when a mutating tool fails', async () => {
    const clearSpy = vi.spyOn(fileIndex, 'clearFileIndexCache')
    const failRun = vi.fn(async () => ({ ok: false, output: 'error: not found' }))
    const registry = new ToolRegistry([
      {
        name: 'edit_file',
        description: 'edit tool',
        inputSchema: {},
        schema: z.object({ path: z.string() }),
        run: failRun,
      },
    ])

    await registry.execute('edit_file', { path: 'a.ts' }, { cwd: process.cwd() })
    expect(clearSpy).not.toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
