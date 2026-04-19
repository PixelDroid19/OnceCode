import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { setEnv } from '../helpers/env.js'
import { importFresh } from '../helpers/module.js'

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

    const oncecodeDir = path.join(homeDir, '.oncecode')
    await mkdir(oncecodeDir, { recursive: true })
    await writeFile(
      path.join(oncecodeDir, 'settings.json'),
      JSON.stringify({ model: 'once-model', maxOutputTokens: 2048, env: { ANTHROPIC_BASE_URL: 'https://api.example.com' } }),
    )
    await writeFile(
      path.join(oncecodeDir, 'mcp.json'),
      JSON.stringify({ mcpServers: { globalFs: { command: 'npx', args: ['fs'] } } }),
    )
    await writeFile(
      path.join(cwdDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { projectFs: { command: 'node', args: ['server.js'] } } }),
    )

    const config = await importFresh<typeof import('@/config/runtime.js')>(
      '@/config/runtime.js', import.meta.url,
    )
    const runtime = await config.loadRuntimeConfig()

    expect(runtime.model.id).toBe('once-model')
    expect(runtime.modelRef).toBe('anthropic:once-model')
    expect(runtime.provider.baseUrl).toBe('https://api.example.com')
    expect(runtime.provider.auth.value).toBe('env-token')
    expect(runtime.maxOutputTokens).toBe(2048)
    expect(Object.keys(runtime.mcpServers).sort()).toEqual(['globalFs', 'projectFs'])
  })

  it('prefers provider connections from providers.json', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir, ANTHROPIC_AUTH_TOKEN: undefined, OPENAI_API_KEY: undefined })
    process.chdir(cwdDir)

    const oncecodeDir = path.join(homeDir, '.oncecode')
    await mkdir(oncecodeDir, { recursive: true })
    await writeFile(
      path.join(oncecodeDir, 'providers.json'),
      JSON.stringify({
        activeProvider: 'openai',
        activeModel: 'openai:gpt-4o',
        providers: {
          openai: {
            providerId: 'openai',
            vars: { OPENAI_API_KEY: 'store-token' },
            baseUrl: 'https://api.openai.example/v1',
            model: 'openai:gpt-4o',
          },
        },
      }),
    )

    const config = await importFresh<typeof import('@/config/runtime.js')>(
      '@/config/runtime.js', import.meta.url,
    )
    const runtime = await config.loadRuntimeConfig()

    expect(runtime.provider.id).toBe('openai')
    expect(runtime.provider.baseUrl).toBe('https://api.openai.example/v1')
    expect(runtime.provider.auth.value).toBe('store-token')
    expect(runtime.modelRef).toBe('openai:gpt-4o')
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

    const config = await importFresh<typeof import('@/config/runtime.js')>(
      '@/config/runtime.js', import.meta.url,
    )
    await expect(config.loadRuntimeConfig()).rejects.toThrow('No auth configured for Anthropic')
  })

  it('reads and writes MCP token files', async () => {
    homeDir = await makeTempDir('oncecode-home')
    setEnv({ HOME: homeDir })
    const config = await importFresh<typeof import('@/config/runtime.js')>(
      '@/config/runtime.js', import.meta.url,
    )

    await config.saveMcpTokensFile({ demo: 'token-1' })
    await expect(config.readMcpTokensFile()).resolves.toEqual({ demo: 'token-1' })
  })
})
