import { readMcpTokensFile } from '../config.js'
import { getErrorCode } from '../utils/errors.js'

export function formatChildProcessError(
  serverName: string,
  command: string,
  stderrLines: string[],
  error: unknown,
): Error {
  const code = getErrorCode(error) ?? undefined
  const detail =
    error instanceof Error ? error.message : String(error)

  const lines = [`Failed to start MCP server "${serverName}" using command "${command}".`]

  if (code === 'ENOENT') {
    lines.push(
      `Command not found: ${command}. Install it first and ensure it is available in PATH.`,
    )
  } else if (detail) {
    lines.push(detail)
  }

  if (detail && code === 'ENOENT') {
    lines.push(`Original error: ${detail}`)
  }

  if (stderrLines.length > 0) {
    lines.push(stderrLines.join('\n'))
  }

  return new Error(lines.join('\n'))
}

export function isInitializeTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('request timed out for initialize')
  )
}

export function toStringRecord(
  values: Record<string, string | number> | undefined,
): Record<string, string> {
  if (!values) return {}
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value)]),
  )
}

export function interpolateEnv(value: string): string {
  return value.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_match, simple, braced) => {
    const key = String(simple ?? braced ?? '').trim()
    if (!key) return ''
    return process.env[key] ?? ''
  })
}

export function resolveHeaderRecord(
  values: Record<string, string | number> | undefined,
): Record<string, string> {
  const raw = toStringRecord(values)
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, interpolateEnv(value)]),
  )
}

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
