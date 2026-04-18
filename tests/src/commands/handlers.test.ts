import { describe, expect, it, vi } from 'vitest'

const loadRuntimeConfig = vi.fn()
const saveOnceCodeSettings = vi.fn()

vi.mock('@/config/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('@/config/runtime.js')>('@/config/runtime.js')
  return {
    ...actual,
    loadRuntimeConfig,
    saveOnceCodeSettings,
  }
})

describe('cli-commands', () => {
  it('formats slash commands', async () => {
    const { formatSlashCommands, findMatchingSlashCommands } = await import('@/commands/handlers.js')
    expect(formatSlashCommands()).toContain('/help')
    expect(findMatchingSlashCommands('/mo')).toContain('/model')
  })

  it('handles local commands like /config-paths and /model', async () => {
    loadRuntimeConfig.mockResolvedValueOnce({
      model: 'demo-model',
      baseUrl: 'https://api.example.com',
      authToken: 'token',
      mcpServers: { fs: { command: 'npx' } },
      sourceSummary: 'config chain',
    })

    const { tryHandleLocalCommand } = await import('@/commands/handlers.js')
    await expect(tryHandleLocalCommand('/status')).resolves.toContain('demo-model')
    await expect(tryHandleLocalCommand('/model test-model')).resolves.toContain('saved model=test-model')
    expect(saveOnceCodeSettings).toHaveBeenCalledWith({ model: 'test-model' })
  })

  it('supports viewing and changing the UI language', async () => {
    const { tryHandleLocalCommand } = await import('@/commands/handlers.js')

    await expect(tryHandleLocalCommand('/language')).resolves.toContain('Current UI language:')
    await expect(tryHandleLocalCommand('/language es')).resolves.toContain('Idioma de la interfaz cambiado')
    expect(saveOnceCodeSettings).toHaveBeenCalledWith({ language: 'es' })
  })
})
