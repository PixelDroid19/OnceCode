import { describe, expect, it, vi } from 'vitest'

const execStreaming = vi.fn()

vi.mock('@/utils/exec-streaming.js', () => ({
  execStreaming,
}))

describe('tools/grep-files', () => {
  it('runs ripgrep and returns stdout', async () => {
    execStreaming.mockResolvedValueOnce({
      stdout: 'src/index.ts:1:test',
      stderr: '',
      exitCode: 0,
      truncated: false,
    })
    const { grepFilesTool } = await import('@/tools/grep-files.js')
    const result = await grepFilesTool.run({ pattern: 'test' }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('src/index.ts:1:test')
  })

  it('appends truncation marker when output is truncated', async () => {
    execStreaming.mockResolvedValueOnce({
      stdout: 'match',
      stderr: '',
      exitCode: 0,
      truncated: true,
    })
    const { grepFilesTool } = await import('@/tools/grep-files.js')
    const result = await grepFilesTool.run({ pattern: 'test' }, { cwd: process.cwd() })
    expect(result.output).toContain('... (output truncated)')
  })
})
