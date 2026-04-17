import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { ToolRegistry } from '../../src/tool.js'
import { runTtyApp } from '../../src/tty-app.js'

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('tty-app', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enters tty mode and exits cleanly on ctrl-c', async () => {
    const writes: string[] = []
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write)

    const stdin = process.stdin as typeof process.stdin & EventEmitter & {
      setRawMode?: (value: boolean) => void
      pause: () => typeof process.stdin
    }
    const setRawMode = vi.fn()
    vi.spyOn(process.stdin, 'pause').mockImplementation(() => process.stdin)
    Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true })
    stdin.setRawMode = setRawMode
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 })
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 40 })

    const tools = new ToolRegistry([
      {
        name: 'demo',
        description: 'demo',
        inputSchema: {},
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'ok' })),
      },
    ])

    const promise = runTtyApp({
      runtime: null,
      tools,
      model: {
        next: vi.fn(async () => ({ type: 'assistant', content: 'done' })),
      },
      messages: [{ role: 'system', content: 'system prompt' }],
      cwd: process.cwd(),
      permissions: {
        whenReady: vi.fn(async () => {}),
        getSummary: vi.fn(() => ['cwd: test']),
      } as never,
    })

    await flush()
    stdin.emit('data', Buffer.from('h'))
    stdin.emit('data', Buffer.from('i'))
    await flush()
    await flush()
    stdin.emit('data', Buffer.from('\u0003'))

    await promise

    expect(stdoutWrite).toHaveBeenCalled()
    expect(setRawMode).toHaveBeenCalledWith(true)
    expect(setRawMode).toHaveBeenCalledWith(false)
    expect(writes.join('')).toContain('oncecode exited.')
  })
})
