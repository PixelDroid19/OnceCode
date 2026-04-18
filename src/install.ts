import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  ONCECODE_SETTINGS_PATH,
  loadEffectiveSettings,
  saveOnceCodeSettings,
} from './config.js'
import { initializeI18n, t } from './i18n/index.js'

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

async function main(): Promise<void> {
  await initializeI18n('en')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const iterator = rl[Symbol.asyncIterator]()
    const nextLine = async (): Promise<string | null> => {
      const result = await iterator.next()
      return result.done ? null : result.value
    }

    const settings = await loadEffectiveSettings()
    const currentEnv = settings.env ?? {}

    console.log(t('install_title'))
    console.log(t('install_config_path', { path: ONCECODE_SETTINGS_PATH }))
    console.log(t('install_settings_note'))
    console.log('')

    const model = await askRequired(
      nextLine,
      'Model name',
      settings.model ? String(settings.model) : String(currentEnv.ANTHROPIC_MODEL ?? ''),
    )
    const baseUrl = await askRequired(
      nextLine,
      'ANTHROPIC_BASE_URL',
      String(currentEnv.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'),
    )
    const savedAuthToken = String(currentEnv.ANTHROPIC_AUTH_TOKEN ?? '')
    process.stdout.write(`ANTHROPIC_AUTH_TOKEN${secretPromptSuffix(savedAuthToken)}: `)
    const tokenInput = ((await nextLine()) ?? '').trim()
    const authToken = tokenInput || savedAuthToken

    if (!authToken) {
      throw new Error(t('install_token_empty'))
    }

    await saveOnceCodeSettings({
      model,
      env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: authToken,
        ANTHROPIC_MODEL: model,
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
    console.log(t('install_config_file', { path: ONCECODE_SETTINGS_PATH }))
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
