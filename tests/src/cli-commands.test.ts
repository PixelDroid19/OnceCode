import { describe, expect, it, vi } from 'vitest'

const loadRuntimeConfig = vi.fn()
const saveOnceCodeSettings = vi.fn()

vi.mock('../../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/config.js')>('../../src/config.js')
  return {
    ...actual,
    loadRuntimeConfig,
    saveOnceCodeSettings,
  }
})

describe('cli-commands', () => {
  it('formats slash commands', async () => {
    const { formatSlashCommands, findMatchingSlashCommands } = await import('../../src/cli-commands.js')
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

    const { tryHandleLocalCommand } = await import('../../src/cli-commands.js')
    await expect(tryHandleLocalCommand('/status')).resolves.toContain('demo-model')
    await expect(tryHandleLocalCommand('/model test-model')).resolves.toContain('saved model=test-model')
    expect(saveOnceCodeSettings).toHaveBeenCalledWith({ model: 'test-model' })
  })
})
