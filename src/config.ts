import { mkdir, writeFile } from 'node:fs/promises'
import {
  CLAUDE_SETTINGS_PATH,
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
} from './config-store.js'

export type OnceCodeSettings = {
  env?: Record<string, string | number>
  model?: string
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

export type RuntimeConfig = {
  model: string
  baseUrl: string
  authToken?: string
  apiKey?: string
  maxOutputTokens?: number
  mcpServers: Record<string, McpServerConfig>
  sourceSummary: string
}

export type McpConfigScope = 'user' | 'project'

export {
  CLAUDE_SETTINGS_PATH,
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
  saveMcpTokensFile,
  saveScopedMcpServers,
}

function mergeSettings(
  base: OnceCodeSettings,
  override: OnceCodeSettings,
): OnceCodeSettings {
  const mergedMcpServers = {
    ...(base.mcpServers ?? {}),
  }

  for (const [name, server] of Object.entries(override.mcpServers ?? {})) {
    mergedMcpServers[name] = {
      ...(mergedMcpServers[name] ?? {}),
      ...server,
      env: {
        ...(mergedMcpServers[name]?.env ?? {}),
        ...(server.env ?? {}),
      },
      headers: {
        ...(mergedMcpServers[name]?.headers ?? {}),
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
    mcpServers: mergedMcpServers,
  }
}

export async function loadEffectiveSettings(): Promise<OnceCodeSettings> {
  const [claudeSettings, globalMcpConfig, projectMcpConfig, onceCodeSettings] =
    await Promise.all([
      readSettingsFile(CLAUDE_SETTINGS_PATH),
      readMcpConfigFile(ONCECODE_MCP_PATH),
      readMcpConfigFile(PROJECT_MCP_PATH),
      readSettingsFile(ONCECODE_SETTINGS_PATH),
    ])
  return mergeSettings(
    mergeSettings(
      mergeSettings(claudeSettings, { mcpServers: globalMcpConfig }),
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

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const effectiveSettings = await loadEffectiveSettings()
  const env = {
    ...(effectiveSettings.env ?? {}),
    ...process.env,
  }

  const model =
    String(env.ONCECODE_MODEL ?? '').trim() ||
    effectiveSettings.model ||
    String(env.ANTHROPIC_MODEL ?? '').trim()

  const baseUrl =
    String(env.ANTHROPIC_BASE_URL ?? '').trim() || 'https://api.anthropic.com'
  const authToken = String(env.ANTHROPIC_AUTH_TOKEN ?? '').trim() || undefined
  const apiKey = String(env.ANTHROPIC_API_KEY ?? '').trim() || undefined
  const rawMaxOutputTokens =
    env.ONCECODE_MAX_OUTPUT_TOKENS ?? effectiveSettings.maxOutputTokens
  const parsedMaxOutputTokens =
    rawMaxOutputTokens === undefined ? NaN : Number(rawMaxOutputTokens)
  const maxOutputTokens =
    Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
      ? Math.floor(parsedMaxOutputTokens)
      : undefined

  if (!model) {
    throw new Error(
      `No model configured. Set ~/.oncecode/settings.json or env.ANTHROPIC_MODEL.`,
    )
  }

  if (!authToken && !apiKey) {
    throw new Error(
      `No auth configured. Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY in ~/.oncecode/settings.json or process env.`,
    )
  }

  return {
    model,
    baseUrl,
    authToken,
    apiKey,
    maxOutputTokens,
    mcpServers: effectiveSettings.mcpServers ?? {},
    sourceSummary: `config: ${ONCECODE_SETTINGS_PATH} > ${CLAUDE_SETTINGS_PATH} > process.env`,
  }
}
