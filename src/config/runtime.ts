import { mkdir, writeFile } from 'node:fs/promises'
import {
  ONCECODE_DIR,
  ONCECODE_HISTORY_PATH,
  ONCECODE_MCP_PATH,
  ONCECODE_MCP_TOKENS_PATH,
  ONCECODE_PERMISSIONS_PATH,
  ONCECODE_SETTINGS_PATH,
  PROJECT_MCP_PATH,
  getMcpConfigPath,
  loadScopedMcpServers,
  readMcpConfigFile,
  readMcpTokensFile,
  readSettingsFile,
  saveMcpTokensFile,
  saveScopedMcpServers,
} from './store.js'
import {
  ONCECODE_PROVIDERS_PATH,
  readProviderState,
  type ProviderConnection,
  type ProviderState,
} from './provider-store.js'
import { t } from '@/i18n/index.js'
import type { LanguageSetting } from '@/i18n/languages.js'
import {
  createUnknownModel,
  formatModelRef,
  getConfiguredProviders,
  getDefaultModel,
  getModelInfo,
  getProviderInfo,
  inferProvider,
  listProviders,
  parseModelRef,
  resolveSelection,
  type ModelInfo,
  type ProviderInfo,
} from '@/provider/catalog.js'

export type OnceCodeSettings = {
  env?: Record<string, string | number>
  language?: LanguageSetting
  model?: string
  provider?: string
  maxOutputTokens?: number
  mcpServers?: Record<string, McpServerConfig>
}

export type McpServerConfig = {
  command: string
  args?: string[]
  env?: Record<string, string | number>
  url?: string
  headers?: Record<string, string | number>
  cwd?: string
  enabled?: boolean
  protocol?: 'auto' | 'content-length' | 'newline-json' | 'streamable-http'
}

export type RuntimeProviderConfig = {
  id: string
  name: string
  transport: ProviderInfo['transport']
  baseUrl: string
  auth: {
    env: string
    type: 'bearer' | 'header' | 'query'
    value: string
    name?: string
  }
}

export type RuntimeConfig = {
  provider: RuntimeProviderConfig
  model: ModelInfo
  modelRef: string
  maxOutputTokens?: number
  mcpServers: Record<string, McpServerConfig>
  sourceSummary: string
}

export type McpConfigScope = 'user' | 'project'

export {
  ONCECODE_DIR,
  ONCECODE_HISTORY_PATH,
  ONCECODE_MCP_PATH,
  ONCECODE_MCP_TOKENS_PATH,
  ONCECODE_PERMISSIONS_PATH,
  ONCECODE_SETTINGS_PATH,
  PROJECT_MCP_PATH,
  getMcpConfigPath,
  loadScopedMcpServers,
  readMcpConfigFile,
  readMcpTokensFile,
  readSettingsFile,
  saveMcpTokensFile,
  saveScopedMcpServers,
  ONCECODE_PROVIDERS_PATH,
}

function mergeSettings(
  base: OnceCodeSettings,
  override: OnceCodeSettings,
): OnceCodeSettings {
  const mcpServers = {
    ...(base.mcpServers ?? {}),
  }

  for (const [name, server] of Object.entries(override.mcpServers ?? {})) {
    mcpServers[name] = {
      ...(mcpServers[name] ?? {}),
      ...server,
      env: {
        ...(mcpServers[name]?.env ?? {}),
        ...(server.env ?? {}),
      },
      headers: {
        ...(mcpServers[name]?.headers ?? {}),
        ...(server.headers ?? {}),
      },
    }
  }

  return {
    ...base,
    ...override,
    env: {
      ...(base.env ?? {}),
      ...(override.env ?? {}),
    },
    mcpServers,
  }
}

export async function loadEffectiveSettings(): Promise<OnceCodeSettings> {
  const [globalMcpConfig, projectMcpConfig, onceCodeSettings] = await Promise.all([
    readMcpConfigFile(ONCECODE_MCP_PATH),
    readMcpConfigFile(PROJECT_MCP_PATH),
    readSettingsFile(ONCECODE_SETTINGS_PATH),
  ])
  return mergeSettings(
    mergeSettings(
      { mcpServers: globalMcpConfig },
      { mcpServers: projectMcpConfig },
    ),
    onceCodeSettings,
  )
}

export async function saveOnceCodeSettings(
  updates: OnceCodeSettings,
): Promise<void> {
  await mkdir(ONCECODE_DIR, { recursive: true })
  const existing = await readSettingsFile(ONCECODE_SETTINGS_PATH)
  const next = mergeSettings(existing, updates)
  await writeFile(
    ONCECODE_SETTINGS_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  )
}

function getConnection(
  state: ProviderState,
  providerId?: string,
): ProviderConnection | null {
  const id = String(providerId ?? '').trim().toLowerCase()
  if (!id) return null

  const direct = state.providers?.[id]
  if (direct) return direct

  return (
    Object.values(state.providers ?? {}).find(
      item => item.providerId.trim().toLowerCase() === id,
    ) ?? null
  )
}

function pickStoredProviderId(state: ProviderState): string {
  const active = String(state.activeProvider ?? '').trim()
  if (active) return active

  const ids = Object.values(state.providers ?? {})
    .map(item => item.providerId.trim())
    .filter(Boolean)

  return ids.length === 1 ? (ids[0] ?? '') : ''
}

function pickStoredModel(state: ProviderState, providerId?: string): string {
  const active = String(state.activeModel ?? '').trim()
  if (active) return active

  const stored = getConnection(state, providerId)?.model?.trim()
  if (stored) return stored

  const provider = pickStoredProviderId(state)
  if (!provider) return ''

  return getConnection(state, provider)?.model?.trim() ?? ''
}

function toModelId(input: string): string {
  const parsed = parseModelRef(input)
  return parsed ? parsed.modelId : input.trim()
}

function buildStoredEnv(
  settings: OnceCodeSettings,
  state: ProviderState,
): Record<string, string | number> {
  const env = { ...(settings.env ?? {}) }

  for (const item of Object.values(state.providers ?? {})) {
    const provider = getProviderInfo(item.providerId)
    if (!provider) continue

    Object.assign(env, item.vars ?? {})

    if (item.baseUrl && provider.baseUrlEnv[0]) {
      env[provider.baseUrlEnv[0]] = item.baseUrl
    }

    if (item.model && provider.modelEnv[0]) {
      env[provider.modelEnv[0]] = toModelId(item.model)
    }
  }

  return env
}

function pickModelInput(args: {
  env: Record<string, string | number | undefined>
  settings: OnceCodeSettings
  state: ProviderState
}): string {
  const explicit = String(args.env.ONCECODE_MODEL ?? '').trim()
  if (explicit) return explicit

  const stored = pickStoredModel(
    args.state,
    pickStoredProviderId(args.state) || args.settings.provider?.trim(),
  )
  if (stored) return stored

  if (args.settings.model?.trim()) return args.settings.model.trim()

  const provider = pickStoredProviderId(args.state) || args.settings.provider?.trim()
  if (provider) {
    const defaults = getDefaultModel(provider)
    if (defaults) return formatModelRef(defaults)
  }

  for (const info of listProviders()) {
    for (const key of info.modelEnv) {
      const value = String(args.env[key] ?? '').trim()
      if (value) {
        return value.includes(':') ? value : `${info.id}:${value}`
      }
    }
  }

  return ''
}

function pickProvider(args: {
  env: Record<string, string | number | undefined>
  settings: OnceCodeSettings
  state: ProviderState
  modelInput: string
}): ProviderInfo | null {
  const envProvider = String(args.env.ONCECODE_PROVIDER ?? '').trim()
  if (envProvider) {
    return getProviderInfo(envProvider)
  }

  const resolved = resolveSelection({
    input: args.modelInput,
    env: args.env,
  })
  if (resolved) {
    return resolved.provider
  }

  const storedProvider = pickStoredProviderId(args.state)
  if (storedProvider) {
    return getProviderInfo(storedProvider)
  }

  if (args.settings.provider?.trim()) {
    return getProviderInfo(args.settings.provider.trim())
  }

  const configured = getConfiguredProviders(args.env as NodeJS.ProcessEnv)
  if (configured.length === 1) {
    return configured[0] ?? null
  }

  return inferProvider(args.modelInput, args.env)
}

function fallbackProvider(
  env: Record<string, string | number | undefined>,
  state: ProviderState,
): ProviderInfo {
  const stored = getProviderInfo(pickStoredProviderId(state))
  if (stored) {
    return stored
  }

  const configured = getConfiguredProviders(env)
  if (configured.length > 0) {
    return configured[0] ?? listProviders()[0]!
  }

  return getProviderInfo('anthropic') ?? listProviders()[0]!
}

function pickAuth(
  provider: ProviderInfo,
  env: Record<string, string | number | undefined>,
): RuntimeProviderConfig['auth'] | null {
  for (const auth of provider.auth) {
    const value = String(env[auth.env] ?? '').trim()
    if (!value) continue
    return {
      env: auth.env,
      type: auth.type,
      value,
      name: auth.name,
    }
  }

  return null
}

function pickBaseUrl(
  provider: ProviderInfo,
  env: Record<string, string | number | undefined>,
): string {
  for (const key of provider.baseUrlEnv) {
    const value = String(env[key] ?? '').trim()
    if (value) return value
  }

  return provider.defaultBaseUrl
}

function resolveModel(args: {
  provider: ProviderInfo
  input: string
  env: Record<string, string | number | undefined>
}): ModelInfo {
  const resolved = resolveSelection({
    input: args.input,
    providerId: args.provider.id,
    env: args.env,
  })
  if (resolved) return resolved.model

  const trimmed = args.input.trim()
  if (!trimmed) {
    return getDefaultModel(args.provider.id) ?? createUnknownModel(args.provider.id, args.provider.defaultModel)
  }

  return getModelInfo(trimmed, args.provider.id, args.env) ?? createUnknownModel(args.provider.id, trimmed)
}

export function describeRuntimeModel(runtime: RuntimeConfig): string {
  return runtime.modelRef
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const [settings, state] = await Promise.all([
    loadEffectiveSettings(),
    readProviderState(),
  ])
  const sourcePath = `${ONCECODE_PROVIDERS_PATH} or ${ONCECODE_SETTINGS_PATH}`
  const env = {
    ...buildStoredEnv(settings, state),
    ...process.env,
  }
  const modelInput = pickModelInput({ env, settings, state })
  const provider =
    pickProvider({ env, settings, state, modelInput }) ?? fallbackProvider(env, state)

  if (!modelInput.trim()) {
    throw new Error(
      t('config_no_model', {
        settingsPath: sourcePath,
      }),
    )
  }

  const auth = pickAuth(provider, env)
  if (!auth) {
    throw new Error(
      t('config_no_auth', {
        settingsPath: sourcePath,
        provider: provider.name,
        envs: provider.auth.map(item => item.env).join(' or '),
      }),
    )
  }

  const rawMaxOutputTokens = env.ONCECODE_MAX_OUTPUT_TOKENS ?? settings.maxOutputTokens
  const parsedMaxOutputTokens = rawMaxOutputTokens === undefined ? NaN : Number(rawMaxOutputTokens)
  const maxOutputTokens =
    Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
      ? Math.floor(parsedMaxOutputTokens)
      : undefined

  const model = resolveModel({
    provider,
    input: modelInput || provider.defaultModel,
    env,
  })

  return {
    provider: {
      id: provider.id,
      name: provider.name,
      transport: provider.transport,
      baseUrl: pickBaseUrl(provider, env),
      auth,
    },
    model,
    modelRef: formatModelRef(model),
    maxOutputTokens,
    mcpServers: settings.mcpServers ?? {},
    sourceSummary: `config: ${ONCECODE_PROVIDERS_PATH} + ${ONCECODE_SETTINGS_PATH} + process.env`,
  }
}
