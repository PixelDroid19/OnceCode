import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { JsonRpcProtocol, ProtocolCache } from './types.js'

export const MCP_PROTOCOL_CACHE_PATH = path.join(
  os.homedir(),
  '.oncecode',
  'mcp-protocol-cache.json',
)

export async function readProtocolCache(): Promise<ProtocolCache> {
  try {
    const content = await readFile(MCP_PROTOCOL_CACHE_PATH, 'utf8')
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    const cache: ProtocolCache = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value === 'content-length' ||
        value === 'newline-json' ||
        value === 'streamable-http'
      ) {
        cache[key] = value
      }
    }
    return cache
  } catch {
    return {}
  }
}

export async function writeProtocolCache(cache: ProtocolCache): Promise<void> {
  await mkdir(path.dirname(MCP_PROTOCOL_CACHE_PATH), { recursive: true })
  await writeFile(MCP_PROTOCOL_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}
