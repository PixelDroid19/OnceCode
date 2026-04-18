import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readTextFileOrNull } from './utils/fs.js'
import type { McpConfigScope, McpServerConfig, OnceCodeSettings } from './config.js'

/** Root directory for all persistent oncecode state. */
export const ONCECODE_DIR = path.join(os.homedir(), '.oncecode')
/** Path to the global settings JSON file. */
export const ONCECODE_SETTINGS_PATH = path.join(ONCECODE_DIR, 'settings.json')
/** Path to the conversation history JSON file. */
export const ONCECODE_HISTORY_PATH = path.join(ONCECODE_DIR, 'history.json')
/** Path to the persisted permission allowlists/denylists. */
export const ONCECODE_PERMISSIONS_PATH = path.join(ONCECODE_DIR, 'permissions.json')
/** Path to the global MCP server configuration file. */
export const ONCECODE_MCP_PATH = path.join(ONCECODE_DIR, 'mcp.json')
/** Path to the stored OAuth/bearer tokens for MCP servers. */
export const ONCECODE_MCP_TOKENS_PATH = path.join(ONCECODE_DIR, 'mcp-tokens.json')
/** Path to Claude Code's settings file, used as a low-priority config source. */
export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')
/** Path to the project-local MCP server configuration file. */
export const PROJECT_MCP_PATH = path.join(process.cwd(), '.mcp.json')

/** Reads and parses a settings JSON file, returning empty settings on missing file. */
export async function readSettingsFile(filePath: string): Promise<OnceCodeSettings> {
  const content = await readTextFileOrNull(filePath)
  if (!content) {
    return {}
  }

  return JSON.parse(content) as OnceCodeSettings
}

/** Reads the MCP OAuth/bearer token store from disk. */
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

/** Persists the MCP token store to disk. */
export async function saveMcpTokensFile(
  tokens: Record<string, string>,
  filePath = ONCECODE_MCP_TOKENS_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8')
}

/** Reads and parses an MCP config file, extracting the `mcpServers` map. */
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

/** Resolves the MCP config file path for the given scope (user vs project). */
export function getMcpConfigPath(
  scope: McpConfigScope,
  cwd = process.cwd(),
): string {
  return scope === 'project' ? path.join(cwd, '.mcp.json') : ONCECODE_MCP_PATH
}

/** Loads MCP server configs for a given scope. */
export async function loadScopedMcpServers(
  scope: McpConfigScope,
  cwd = process.cwd(),
): Promise<Record<string, McpServerConfig>> {
  return readMcpConfigFile(getMcpConfigPath(scope, cwd))
}

/** Writes the MCP server map to the appropriate scope-specific config file. */
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
