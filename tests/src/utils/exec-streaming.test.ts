import { describe, expect, it } from 'vitest'
import { execStreaming } from '@/utils/exec-streaming'

describe('execStreaming', () => {
  const cwd = process.cwd()

  it('captures stdout from echo', async () => {
    const result = await execStreaming({ command: 'echo', args: ['hello'], cwd })
    expect(result.stdout.trim()).toBe('hello')
    expect(result.exitCode).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('captures stderr', async () => {
    const result = await execStreaming({
      command: 'bash',
      args: ['-c', 'echo err >&2'],
      cwd,
    })
    expect(result.stderr.trim()).toBe('err')
    expect(result.exitCode).toBe(0)
  })

  it('reports correct exit code for failing command', async () => {
    const result = await execStreaming({
      command: 'bash',
      args: ['-c', 'exit 42'],
      cwd,
    })
    expect(result.exitCode).toBe(42)
  })

  it('truncates when maxLines is exceeded', async () => {
    const result = await execStreaming({
      command: 'seq',
      args: ['100'],
      cwd,
      maxLines: 5,
    })
    expect(result.truncated).toBe(true)
    const lines = result.stdout.trim().split('\n')
    expect(lines.length).toBeLessThan(100)
  })

  it('truncates when maxBytes is exceeded', async () => {
    const result = await execStreaming({
      command: 'seq',
      args: ['10000'],
      cwd,
      maxBytes: 100,
    })
    expect(result.truncated).toBe(true)
    expect(result.stdout.length).toBeLessThanOrEqual(150) // small buffer tolerance
  })

  it('rejects for a non-existent command', async () => {
    await expect(
      execStreaming({
        command: 'nonexistent_command_xyz',
        args: [],
        cwd,
      })
    ).rejects.toThrow()
  })
})
