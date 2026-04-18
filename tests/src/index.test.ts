import { afterEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { runOnceCodeCli } from './helpers/cli.js'

describe('index cli entrypoint', () => {
  let homeDir = ''

  afterEach(async () => {
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('handles management help through the real CLI entrypoint', async () => {
    const result = await runOnceCodeCli({
      cwd: process.cwd(),
      argv: ['help'],
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('management commands')
    expect(result.stdout).toContain('oncecode mcp list')
    expect(result.stderr).toBe('')
  })

  it('runs in noninteractive mock mode and prints assistant output', async () => {
    homeDir = await makeTempDir('oncecode-index-home')
    const result = await runOnceCodeCli({
      cwd: process.cwd(),
      stdin: 'hello\n/exit\n',
      env: {
        HOME: homeDir,
        ONCECODE_MODEL_MODE: 'mock',
        ANTHROPIC_AUTH_TOKEN: 'token',
        ANTHROPIC_MODEL: 'claude-3-5-sonnet',
        ANTHROPIC_BASE_URL: 'https://api.example.com',
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('OnceCode')
    expect(result.stdout).toContain('This is a minimal skeleton build.')
    expect(result.stderr).toBe('')
  })
})
