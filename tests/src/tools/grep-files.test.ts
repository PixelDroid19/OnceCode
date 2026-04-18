import { describe, expect, it, vi } from 'vitest'

const execFileAsync = vi.fn()

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util')
  return {
    ...actual,
    promisify: () => execFileAsync,
  }
})

describe('tools/grep-files', () => {
  it('runs ripgrep and returns stdout', async () => {
    execFileAsync.mockResolvedValueOnce({ stdout: 'src/index.ts:1:test', stderr: '' })
    const { grepFilesTool } = await import('@/tools/grep-files.js')
    const result = await grepFilesTool.run({ pattern: 'test' }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('src/index.ts:1:test')
  })
})
