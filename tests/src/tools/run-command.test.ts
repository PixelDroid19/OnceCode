import { describe, expect, it, vi } from 'vitest'

const execStreaming = vi.fn()
const spawn = vi.fn()
const timeoutSignal = vi.fn(() => new AbortController().signal)

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawn,
  }
})

vi.mock('@/utils/exec-streaming.js', () => ({
  execStreaming,
}))

vi.mock('@/utils/abort.js', () => ({
  timeoutSignal,
  createChildController: vi.fn(),
  isAbortError: vi.fn(),
}))

describe('tools/run-command', () => {
  it('runs safe commands through execStreaming', async () => {
    execStreaming.mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      truncated: false,
    })
    const { runCommandTool } = await import('@/tools/run-command.js')
    const result = await runCommandTool.run({ command: 'pwd' }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toBe('ok')
    expect(execStreaming).toHaveBeenCalledOnce()
  })

  it('passes parent signal through timeoutSignal', async () => {
    execStreaming.mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      truncated: false,
    })
    const signal = new AbortController().signal
    const { runCommandTool } = await import('@/tools/run-command.js')
    await runCommandTool.run({ command: 'pwd' }, { cwd: process.cwd(), signal })
    expect(timeoutSignal).toHaveBeenCalledWith(60_000, signal)
  })

  it('prompts permissions for unknown commands', async () => {
    execStreaming.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
      truncated: false,
    })
    const ensureCommand = vi.fn(async () => {})
    const { runCommandTool } = await import('@/tools/run-command.js')
    await runCommandTool.run(
      { command: 'customcmd', args: ['--flag'] },
      { cwd: process.cwd(), permissions: { ensureCommand } as never },
    )
    expect(ensureCommand).toHaveBeenCalledOnce()
  })

  it('registers background shell tasks for shell snippets ending with ampersand', async () => {
    const unref = vi.fn()
    spawn.mockReturnValueOnce({ pid: 1234, unref })
    const { runCommandTool } = await import('@/tools/run-command.js')
    const result = await runCommandTool.run(
      { command: 'sleep 1 &' },
      { cwd: process.cwd(), permissions: { ensureCommand: vi.fn(async () => {}) } as never },
    )
    expect(result.ok).toBe(true)
    expect(result.backgroundTask?.pid).toBe(1234)
    expect(unref).toHaveBeenCalledOnce()
  })

  it('appends truncation marker for large output', async () => {
    execStreaming.mockResolvedValueOnce({
      stdout: 'line 1',
      stderr: '',
      exitCode: 0,
      truncated: true,
    })
    const { runCommandTool } = await import('@/tools/run-command.js')
    const result = await runCommandTool.run({ command: 'pwd' }, { cwd: process.cwd() })
    expect(result.output).toContain('... (output truncated)')
  })
})
