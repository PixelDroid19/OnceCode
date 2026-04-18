import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readTextFileOrNull } from './utils/fs.js'
import type { McpConfigScope, McpServerConfig, OnceCodeSettings } from './config.js'

export const ONCECODE_DIR = path.join(os.homedir(), '.oncecode')
export const ONCECODE_SETTINGS_PATH = path.join(ONCECODE_DIR, 'settings.json')
export const ONCECODE_HISTORY_PATH = path.join(ONCECODE_DIR, 'history.json')
export const ONCECODE_PERMISSIONS_PATH = path.join(ONCECODE_DIR, 'permissions.json')
export const ONCECODE_MCP_PATH = path.join(ONCECODE_DIR, 'mcp.json')
export const ONCECODE_MCP_TOKENS_PATH = path.join(ONCECODE_DIR, 'mcp-tokens.json')
export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
export const PROJECT_MCP_PATH = path.join(process.cwd(), '.mcp.json')

export async function readSettingsFile(filePath: string): Promise<OnceCodeSettings> {
  const content = await readTextFileOrNull(filePath)
  if (!content) {
    return {}
  }

  return JSON.parse(content) as OnceCodeSettings
}

export async function readMcpTokensFile(
  filePath = ONCECODE_MCP_TOKENS_PATH,
): Promise<Record<string, string>> {
  const content = await readTextFileOrNull(filePath)
  if (!content) {
    return {}
  }

  const parsed = JSON.parse(content) as unknown
  if (typeof parsed !== 'object' || parsed === null) {
    return {}
  }
  return parsed as Record<string, string>
}

export async function saveMcpTokensFile(
  tokens: Record<string, string>,
  filePath = ONCECODE_MCP_TOKENS_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8')
}

export async function readMcpConfigFile(
  filePath: string,
): Promise<Record<string, McpServerConfig>> {
  const content = await readTextFileOrNull(filePath)
  if (!content) {
    return {}
  }

  const parsed = JSON.parse(content) as unknown
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('mcpServers' in parsed) ||
    typeof parsed.mcpServers !== 'object' ||
    parsed.mcpServers === null
  ) {
    return {}
  }

  return parsed.mcpServers as Record<string, McpServerConfig>
}

export function getMcpConfigPath(
  scope: McpConfigScope,
  cwd = process.cwd(),
): string {
  return scope === 'project' ? path.join(cwd, '.mcp.json') : ONCECODE_MCP_PATH
}

export async function loadScopedMcpServers(
  scope: McpConfigScope,
  cwd = process.cwd(),
): Promise<Record<string, McpServerConfig>> {
  return readMcpConfigFile(getMcpConfigPath(scope, cwd))
}

export async function saveScopedMcpServers(
  scope: McpConfigScope,
  servers: Record<string, McpServerConfig>,
  cwd = process.cwd(),
): Promise<void> {
  const targetPath = getMcpConfigPath(scope, cwd)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(
    targetPath,
    `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`,
    'utf8',
  )
}
