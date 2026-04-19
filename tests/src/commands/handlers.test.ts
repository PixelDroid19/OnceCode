import { describe, expect, it, vi } from 'vitest'

const loadRuntimeConfig = vi.fn()
const saveOnceCodeSettings = vi.fn()
const readProviderState = vi.fn()
const saveProviderConnection = vi.fn()
const setActiveProviderSelection = vi.fn()

vi.mock('@/config/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('@/config/runtime.js')>('@/config/runtime.js')
  return {
    ...actual,
    loadRuntimeConfig,
    saveOnceCodeSettings,
  }
})

vi.mock('@/config/provider-store.js', async () => {
  const actual = await vi.importActual<typeof import('@/config/provider-store.js')>('@/config/provider-store.js')
  return {
    ...actual,
    readProviderState,
    saveProviderConnection,
    setActiveProviderSelection,
  }
})

describe('cli-commands', () => {
  it('formats slash commands', async () => {
    const { formatSlashCommands, findMatchingSlashCommands } = await import('@/commands/handlers.js')
    expect(formatSlashCommands()).toContain('/help')
    expect(findMatchingSlashCommands('/mo')).toContain('/model')
  })

  it('handles local commands like /config-paths and /model', async () => {
    readProviderState.mockResolvedValue({
      activeProvider: 'anthropic',
      activeModel: 'anthropic:test-model',
      providers: {
        anthropic: { providerId: 'anthropic', model: 'anthropic:test-model', vars: {} },
      },
    })
    setActiveProviderSelection.mockResolvedValue(undefined)
    saveProviderConnection.mockResolvedValue(undefined)
    loadRuntimeConfig.mockResolvedValueOnce({
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        transport: 'anthropic',
        baseUrl: 'https://api.example.com',
        auth: {
          env: 'ANTHROPIC_AUTH_TOKEN',
          type: 'bearer',
          value: 'token',
        },
      },
      model: {
        id: 'demo-model',
        ref: 'anthropic:demo-model',
        name: 'demo-model',
        api: 'demo-model',
        providerId: 'anthropic',
        aliases: [],
        defaultOutput: 32_000,
        limits: { context: 200_000, output: 64_000 },
        capabilities: {
          attachment: true,
          reasoning: false,
          temperature: true,
          toolCall: true,
          interleaved: false,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
        },
        known: false,
      },
      modelRef: 'anthropic:demo-model',
      mcpServers: { fs: { command: 'npx' } },
      sourceSummary: 'config chain',
    })

    const { tryHandleLocalCommand } = await import('@/commands/handlers.js')
    await expect(tryHandleLocalCommand('/status')).resolves.toContain('demo-model')
    loadRuntimeConfig.mockResolvedValueOnce({
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        transport: 'anthropic',
        baseUrl: 'https://api.example.com',
        auth: {
          env: 'ANTHROPIC_AUTH_TOKEN',
          type: 'bearer',
          value: 'token',
        },
      },
      model: {
        id: 'test-model',
        ref: 'anthropic:test-model',
        name: 'test-model',
        api: 'test-model',
        providerId: 'anthropic',
        aliases: [],
        defaultOutput: 32_000,
        limits: { context: 200_000, output: 64_000 },
        capabilities: {
          attachment: true,
          reasoning: false,
          temperature: true,
          toolCall: true,
          interleaved: false,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
        },
        known: false,
      },
      modelRef: 'anthropic:test-model',
      mcpServers: { fs: { command: 'npx' } },
      sourceSummary: 'config chain',
    })
    await expect(tryHandleLocalCommand('/model test-model')).resolves.toContain('saved model=test-model')
    expect(setActiveProviderSelection).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'anthropic:test-model',
    })
    expect(saveProviderConnection).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'anthropic:test-model',
      activate: false,
    })
  })

  it('shows connected providers from provider state', async () => {
    readProviderState.mockResolvedValue({
      activeProvider: 'anthropic',
      activeModel: 'anthropic:test-model',
      providers: {
        anthropic: { providerId: 'anthropic', model: 'anthropic:test-model', vars: {} },
        openai: { providerId: 'openai', model: 'openai:gpt-4o', vars: {} },
      },
    })
    loadRuntimeConfig.mockResolvedValue({
      provider: {
        id: 'anthropic',
        name: 'Anthropic',
        transport: 'anthropic',
        baseUrl: 'https://api.example.com',
        auth: {
          env: 'ANTHROPIC_AUTH_TOKEN',
          type: 'bearer',
          value: 'token',
        },
      },
      model: {
        id: 'test-model',
        ref: 'anthropic:test-model',
        name: 'test-model',
        api: 'test-model',
        providerId: 'anthropic',
        aliases: [],
        defaultOutput: 32_000,
        limits: { context: 200_000, output: 64_000 },
        capabilities: {
          attachment: true,
          reasoning: false,
          temperature: true,
          toolCall: true,
          interleaved: false,
          input: { text: true, audio: false, image: true, video: false, pdf: true },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
        },
        known: false,
      },
      modelRef: 'anthropic:test-model',
      mcpServers: {},
      sourceSummary: 'config chain',
    })

    const { tryHandleLocalCommand } = await import('@/commands/handlers.js')
    await expect(tryHandleLocalCommand('/providers')).resolves.toContain('connected providers: 2')
  })

  it('supports viewing and changing the UI language', async () => {
    const { tryHandleLocalCommand } = await import('@/commands/handlers.js')

    await expect(tryHandleLocalCommand('/language')).resolves.toContain('Current UI language:')
    await expect(tryHandleLocalCommand('/language es')).resolves.toContain('Idioma de la interfaz cambiado')
    expect(saveOnceCodeSettings).toHaveBeenCalledWith({ language: 'es' })
  })
})
