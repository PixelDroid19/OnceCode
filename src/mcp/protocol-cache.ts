import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ONCECODE_DIR } from '@/config/store.js'
import type { ProtocolCache } from './types.js'

/** Path to the on-disk protocol negotiation cache. */
export const MCP_PROTOCOL_CACHE_PATH = path.join(
  ONCECODE_DIR,
  'mcp-protocol-cache.json',
)

/** Reads the cached protocol negotiation results from disk. */
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

/** Persists the protocol negotiation cache to disk. */
export async function writeProtocolCache(cache: ProtocolCache): Promise<void> {
  await mkdir(path.dirname(MCP_PROTOCOL_CACHE_PATH), { recursive: true })
  await writeFile(MCP_PROTOCOL_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
}
