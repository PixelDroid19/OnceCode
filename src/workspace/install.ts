import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  loadEffectiveSettings,
  saveOnceCodeSettings,
} from '@/config/runtime.js'
import {
  ONCECODE_PROVIDERS_PATH,
} from '@/config/runtime.js'
import {
  readProviderState,
  saveProviderConnection,
  setActiveProviderSelection,
} from '@/config/provider-store.js'
import { initializeI18n, t } from '@/i18n/index.js'
import {
  formatModelRef,
  getConfiguredProviders,
  getDefaultModel,
  getProviderInfo,
  hydrateCatalog,
  listProviders,
  resolveSelection,
} from '@/provider/catalog.js'

function hasPathEntry(target: string): boolean {
  const pathEntries = (process.env.PATH ?? '').split(':')
  return pathEntries.includes(target)
}

async function askRequired(
  nextLine: () => Promise<string | null>,
  label: string,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : ''
    process.stdout.write(`${label}${suffix}: `)
    const incoming = await nextLine()
    const answer = (incoming ?? '').trim()
    const value = answer || defaultValue || ''
    if (value) return value
    console.log(t('install_field_required'))
  }
}

function secretPromptSuffix(secret?: string): string {
  if (!secret) return ' [not set]'
  return ' [saved]'
}

function listProviderChoices(): string {
  return listProviders()
    .map(provider => `${provider.id} (${provider.name})`)
    .join(', ')
}

async function main(): Promise<void> {
  await initializeI18n('en')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    if (!String(process.env.ONCECODE_DISABLE_MODELS_FETCH ?? '').trim()) {
      await hydrateCatalog().catch(() => {})
    }

    const iterator = rl[Symbol.asyncIterator]()
    const nextLine = async (): Promise<string | null> => {
      const result = await iterator.next()
      return result.done ? null : result.value
    }

    const settings = await loadEffectiveSettings()
    const state = await readProviderState()
    const currentEnv = settings.env ?? {}

    console.log(t('install_title'))
    console.log(t('install_config_path', { path: ONCECODE_PROVIDERS_PATH }))
    console.log(t('install_settings_note'))
    console.log('')

    const currentProvider =
      String(state.activeProvider ?? '').trim() ||
      String(settings.provider ?? '').trim() ||
      getConfiguredProviders(currentEnv as NodeJS.ProcessEnv)[0]?.id ||
      'anthropic'
    const providerId = await askRequired(
      nextLine,
      'Provider',
      currentProvider,
    )
    const provider = getProviderInfo(providerId)
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}. Available: ${listProviderChoices()}`)
    }

    const model = await askRequired(
      nextLine,
      'Model name',
      String(state.activeModel ?? '').trim() ||
        settings.model ||
        formatModelRef(getDefaultModel(provider.id) ?? { providerId: provider.id, id: provider.defaultModel }),
    )
    const resolved = resolveSelection({
      input: model,
      providerId: provider.id,
      env: currentEnv,
    })
    const modelRef = resolved ? formatModelRef(resolved.model) : `${provider.id}:${model}`
    const baseUrl = await askRequired(
      nextLine,
      provider.baseUrlEnv[0] ?? 'BASE_URL',
      String(currentEnv[provider.baseUrlEnv[0] ?? ''] ?? provider.defaultBaseUrl),
    )
    const auth = provider.auth[0]
    const savedAuthToken = String(currentEnv[auth?.env ?? ''] ?? '')
    process.stdout.write(`${auth?.env ?? 'API_KEY'}${secretPromptSuffix(savedAuthToken)}: `)
    const tokenInput = ((await nextLine()) ?? '').trim()
    const authToken = tokenInput || savedAuthToken

    if (!authToken) {
      throw new Error(t('install_token_empty', { env: auth?.env ?? 'API_KEY' }))
    }

    await saveProviderConnection({
      providerId: provider.id,
      baseUrl,
      model: modelRef,
      vars: {
        [auth?.env ?? 'API_KEY']: authToken,
      },
    })
    await setActiveProviderSelection({
      providerId: provider.id,
      model: modelRef,
    })
    await saveOnceCodeSettings({
      env: {
        [provider.modelEnv[0] ?? 'MODEL']: resolved?.model.api ?? model,
      },
    })

    const home = os.homedir()
    const targetBinDir = path.join(home, '.local', 'bin')
    const launcherPath = path.join(targetBinDir, 'oncecode')
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const launcherScript = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `exec "${path.join(repoRoot, 'bin', 'oncecode')}" "$@"`,
      '',
    ].join('\n')

    await mkdir(targetBinDir, { recursive: true })
    await writeFile(launcherPath, launcherScript, { mode: 0o755 })

    console.log('')
    console.log(t('install_complete'))
    console.log(t('install_config_file', { path: ONCECODE_PROVIDERS_PATH }))
    console.log(t('install_launch_command', { path: launcherPath }))

    if (!hasPathEntry(targetBinDir)) {
      console.log('')
      console.log(t('install_path_missing', { path: targetBinDir }))
      console.log(t('install_path_hint'))
      console.log(`export PATH="${targetBinDir}:$PATH"`)
    } else {
      console.log('')
      console.log(t('install_success'))
    }
  } finally {
    rl.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
