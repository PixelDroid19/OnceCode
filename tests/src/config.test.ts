import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { setEnv } from './helpers/env.js'
import { importFresh } from './helpers/module.js'

const originalCwd = process.cwd()

describe('config', () => {
  let homeDir = ''
  let cwdDir = ''

  afterEach(async () => {
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd)
    }
    if (cwdDir) {
      await removeTempDir(cwdDir)
      cwdDir = ''
    }
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('loads runtime config from merged settings and env', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir, ANTHROPIC_AUTH_TOKEN: 'env-token' })
    process.chdir(cwdDir)

    const claudeDir = path.join(homeDir, '.claude')
    const oncecodeDir = path.join(homeDir, '.oncecode')
    await mkdir(claudeDir, { recursive: true })
    await mkdir(oncecodeDir, { recursive: true })
    await writeFile(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-base', env: { ANTHROPIC_BASE_URL: 'https://claude.example' } }),
    )
    await writeFile(
      path.join(oncecodeDir, 'settings.json'),
      JSON.stringify({ model: 'once-model', maxOutputTokens: 2048 }),
    )
    await writeFile(
      path.join(oncecodeDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { globalFs: { command: 'npx', args: ['fs'] } } }),
    )
    await writeFile(
      path.join(cwdDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { projectFs: { command: 'node', args: ['server.js'] } } }),
    )

    const config = await importFresh<typeof import('../../src/config.js')>(
      '../../src/config.js',
    )
    const runtime = await config.loadRuntimeConfig()

    expect(runtime.model).toBe('once-model')
    expect(runtime.baseUrl).toBe('https://claude.example')
    expect(runtime.authToken).toBe('env-token')
    expect(runtime.maxOutputTokens).toBe(2048)
    expect(Object.keys(runtime.mcpServers).sort()).toEqual(['globalFs', 'projectFs'])
  })

  it('throws when auth is missing', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir, ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_API_KEY: undefined })
    process.chdir(cwdDir)
    await mkdir(path.join(homeDir, '.oncecode'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oncecode', 'settings.json'),
      JSON.stringify({ model: 'once-model' }),
    )

    const config = await importFresh<typeof import('../../src/config.js')>(
      '../../src/config.js',
    )
    await expect(config.loadRuntimeConfig()).rejects.toThrow('No auth configured')
  })

  it('reads and writes MCP token files', async () => {
    homeDir = await makeTempDir('oncecode-home')
    setEnv({ HOME: homeDir })
    const config = await importFresh<typeof import('../../src/config.js')>(
      '../../src/config.js',
    )

    await config.saveMcpTokensFile({ demo: 'token-1' })
    await expect(config.readMcpTokensFile()).resolves.toEqual({ demo: 'token-1' })
  })
})
