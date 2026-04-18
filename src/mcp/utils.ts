import { readMcpTokensFile } from '@/config/runtime.js'
import { t } from '@/i18n/index.js'
import { getErrorCode } from '@/utils/errors.js'

/** Builds a descriptive Error for when an MCP server child process fails to start. */
export function formatChildProcessError(
  serverName: string,
  command: string,
  stderrLines: string[],
  error: unknown,
): Error {
  const code = getErrorCode(error) ?? undefined
  const detail =
    error instanceof Error ? error.message : String(error)

  const lines = [t('mcp_start_failed', { name: serverName, command })]

  if (code === 'ENOENT') {
    lines.push(
      t('mcp_command_not_found', { command }),
    )
  } else if (detail) {
    lines.push(detail)
  }

  if (detail && code === 'ENOENT') {
    lines.push(t('mcp_original_error', { detail }))
  }

  if (stderrLines.length > 0) {
    lines.push(stderrLines.join('\n'))
  }

  return new Error(lines.join('\n'))
}

/** Checks if an error is the specific timeout during MCP initialize handshake. */
export function isInitializeTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('request timed out for initialize')
  )
}

/** Coerces a string|number record to a string-only record. */
export function toStringRecord(
  values: Record<string, string | number> | undefined,
): Record<string, string> {
  if (!values) return {}
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value)]),
  )
}

/** Expands `$VAR` and `${VAR}` references in a string from process.env. */
export function interpolateEnv(value: string): string {
  return value.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_match, simple, braced) => {
    const key = String(simple ?? braced ?? '').trim()
    if (!key) return ''
    return process.env[key] ?? ''
  })
}

/** Converts a header config to string values with env var interpolation. */
export function resolveHeaderRecord(
  values: Record<string, string | number> | undefined,
): Record<string, string> {
  const raw = toStringRecord(values)
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, interpolateEnv(value)]),
  )
}

/** Parses WWW-Authenticate headers for OAuth resource metadata hints. */
export function extractAuthHint(headers: Headers): string | null {
  const challenges = headers.get('www-authenticate')
  if (!challenges) return null
  const parts: string[] = [challenges]
  const resourceMetadata = /resource_metadata="([^"]+)"/i.exec(challenges)?.[1]
  const authorizationUri = /authorization_uri="([^"]+)"/i.exec(challenges)?.[1]
  if (resourceMetadata) {
    parts.push(`resource_metadata=${resourceMetadata}`)
  }
  if (authorizationUri) {
    parts.push(`authorization_uri=${authorizationUri}`)
  }
  return parts.join('\n')
}

const mcpTokenCache = new Map<string, string>()

/** Loads a cached bearer token for an MCP server from the token store. */
export async function loadMcpToken(serverName: string): Promise<string | undefined> {
  if (mcpTokenCache.has(serverName)) {
    return mcpTokenCache.get(serverName)
  }
  const tokens = await readMcpTokensFile()
  const token = tokens[serverName]?.trim()
  if (token) {
    mcpTokenCache.set(serverName, token)
    return token
  }
  return undefined
}
