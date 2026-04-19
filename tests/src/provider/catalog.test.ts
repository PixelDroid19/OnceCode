import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setEnv } from '../helpers/env.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { importFresh } from '../helpers/module.js'

describe('provider catalog', () => {
  let homeDir = ''

  afterEach(async () => {
    vi.restoreAllMocks()
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('hydrates from cached models file', async () => {
    homeDir = await makeTempDir('oncecode-models-home')
    setEnv({ HOME: homeDir, ONCECODE_DISABLE_MODELS_FETCH: '1' })
    await mkdir(path.join(homeDir, '.oncecode'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oncecode', 'models.json'),
      JSON.stringify({
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: ['OPENAI_API_KEY'],
          api: 'https://api.openai.com/v1',
          models: {
            'gpt-test': {
              id: 'gpt-test',
              name: 'GPT Test',
              attachment: true,
              reasoning: false,
              tool_call: true,
              temperature: true,
              modalities: {
                input: ['text'],
                output: ['text'],
              },
              limit: { context: 1234, output: 567 },
              release_date: '2026-01-01',
            },
          },
        },
      }),
    )

    const mod = await importFresh<typeof import('@/provider/catalog.js')>(
      '@/provider/catalog.js',
      import.meta.url,
    )

    await mod.hydrateCatalog()

    expect(mod.getProviderInfo('openai')?.defaultBaseUrl).toBe('https://api.openai.com/v1')
    expect(mod.getModelInfo('openai:gpt-test')?.limits.context).toBe(1234)
  })

  it('refreshes catalog from models.dev response', async () => {
    homeDir = await makeTempDir('oncecode-models-home')
    setEnv({ HOME: homeDir, ONCECODE_DISABLE_MODELS_FETCH: undefined })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          google: {
            id: 'google',
            name: 'Google Gemini',
            env: ['GEMINI_API_KEY'],
            api: 'https://generativelanguage.googleapis.com/v1beta',
            models: {
              'gemini-test': {
                id: 'gemini-test',
                name: 'Gemini Test',
                attachment: true,
                reasoning: true,
                tool_call: true,
                temperature: true,
                modalities: {
                  input: ['text', 'image'],
                  output: ['text'],
                },
                limit: { context: 999, output: 111 },
                release_date: '2026-02-02',
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const mod = await importFresh<typeof import('@/provider/catalog.js')>(
      '@/provider/catalog.js',
      import.meta.url,
    )

    await expect(mod.refreshCatalog(true)).resolves.toBe(true)
    expect(mod.getProviderInfo('google')?.auth[0]?.env).toBe('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(mod.getModelInfo('google:gemini-test')?.capabilities.reasoning).toBe(true)
  })
})
