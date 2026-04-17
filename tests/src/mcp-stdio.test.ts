import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { setEnv } from './helpers/env.js'

const spawn = vi.fn()

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn,
  }
})

describe('mcp stdio', () => {
  let homeDir = ''

  afterEach(() => {
    vi.restoreAllMocks()
    spawn.mockReset()
  })

  afterEach(async () => {
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('falls back from content-length to newline-json for stdio servers', async () => {
    homeDir = await makeTempDir('oncecode-mcp-home')
    setEnv({ HOME: homeDir })
    const { createMcpBackedTools } = await import('../../src/mcp.js')
    const writes: string[] = []
    let initializeCount = 0

    spawn.mockImplementation(() => {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      const stdin = new PassThrough()
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough
        stderr: PassThrough
        stdin: PassThrough
        kill: ReturnType<typeof vi.fn>
        once: typeof EventEmitter.prototype.once
        on: typeof EventEmitter.prototype.on
        off: typeof EventEmitter.prototype.off
      }

      child.stdout = stdout
      child.stderr = stderr
      child.stdin = stdin
      child.kill = vi.fn(() => true)

      stdin.on('data', chunk => {
        const payload = String(chunk)
        writes.push(payload)

        if (payload.includes('"method":"initialize"')) {
          initializeCount += 1
          const idMatch = payload.match(/"id":(\d+)/)
          const id = Number(idMatch?.[1] ?? '1')
          if (initializeCount === 1) {
            queueMicrotask(() => {
              child.emit('exit', 1)
            })
            return
          }
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: {} })}\n`)
          return
        }

        if (payload.includes('"method":"tools/list"')) {
          const id = Number(payload.match(/"id":(\d+)/)?.[1] ?? '2')
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { tools: [{ name: 'search', description: 'Search docs', inputSchema: { type: 'object' } }] } })}\n`)
          return
        }

        if (payload.includes('"method":"resources/list"')) {
          const id = Number(payload.match(/"id":(\d+)/)?.[1] ?? '3')
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { resources: [] } })}\n`)
          return
        }

        if (payload.includes('"method":"prompts/list"')) {
          const id = Number(payload.match(/"id":(\d+)/)?.[1] ?? '4')
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { prompts: [] } })}\n`)
          return
        }
      })

      queueMicrotask(() => {
        child.emit('spawn')
      })

      return child
    })

    const result = await createMcpBackedTools({
      cwd: process.cwd(),
      mcpServers: {
        docs: {
          command: 'node',
          args: ['server.js'],
        },
      },
    })

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(result.servers).toEqual([
      expect.objectContaining({
        name: 'docs',
        status: 'connected',
        toolCount: 1,
        protocol: 'newline-json',
      }),
    ])
    expect(result.tools.map(tool => tool.name)).toContain('mcp__docs__search')
    expect(writes.some(write => write.includes('Content-Length:'))).toBe(true)
    expect(writes.some(write => write.trim().startsWith('{'))).toBe(true)

    await result.dispose()
  })
})
