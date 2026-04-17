import { describe, expect, it, vi } from 'vitest'

const execFileAsync = vi.fn()
const spawn = vi.fn()

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execFile: vi.fn(),
    spawn,
  }
})

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util')
  return {
    ...actual,
    promisify: () => execFileAsync,
  }
})

describe('tools/run-command', () => {
  it('runs safe commands directly', async () => {
    execFileAsync.mockResolvedValueOnce({ stdout: 'ok', stderr: '' })
    const { runCommandTool } = await import('../../../src/tools/run-command.js')
    const result = await runCommandTool.run({ command: 'pwd' }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('ok')
  })

  it('prompts permissions for unknown commands', async () => {
    execFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' })
    const ensureCommand = vi.fn(async () => {})
    const { runCommandTool } = await import('../../../src/tools/run-command.js')
    await runCommandTool.run(
      { command: 'customcmd', args: ['--flag'] },
      { cwd: process.cwd(), permissions: { ensureCommand } as never },
    )
    expect(ensureCommand).toHaveBeenCalledOnce()
  })

  it('registers background shell tasks for shell snippets ending with ampersand', async () => {
    const unref = vi.fn()
    spawn.mockReturnValueOnce({ pid: 1234, unref })
    const { runCommandTool } = await import('../../../src/tools/run-command.js')
    const result = await runCommandTool.run(
      { command: 'sleep 1 &' },
      { cwd: process.cwd(), permissions: { ensureCommand: vi.fn(async () => {}) } as never },
    )
    expect(result.ok).toBe(true)
    expect(result.backgroundTask?.pid).toBe(1234)
    expect(unref).toHaveBeenCalledOnce()
  })
})
