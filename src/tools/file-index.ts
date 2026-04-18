import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_LIST_FILES_RESULTS } from '@/constants.js'
import { getFrecencyScore } from '@/tools/frecency.js'

type IndexedEntry = {
  relativePath: string
  kind: 'file' | 'dir'
  /** Populated lazily only when needed for sorting top results. */
  modifiedMs: number
}

type FileIndex = {
  root: string
  entries: IndexedEntry[]
  /** Entries grouped by parent directory for O(1) subtree lookups. */
  prefixMap: Map<string, IndexedEntry[]>
  builtAt: number
}

const INDEX_TTL_MS = 5_000
const MAX_INDEXED_ENTRIES = 20_000
const IGNORED_PATTERN = /^(?:\.git|node_modules|\.idea|\.vscode|dist|build|\.next|\.turbo|\.cache)$/

const indexCache = new Map<string, FileIndex>()
/** Tracks in-flight index builds to avoid duplicate work. */
const inflightBuilds = new Map<string, Promise<FileIndex>>()

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/')
}

function scoreEntry(relativePath: string, query: string): number {
  const normalizedPath = relativePath.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return 0
  }

  const fileName = path.basename(normalizedPath)
  let score = 0

  if (fileName === normalizedQuery) score += 400
  if (normalizedPath === normalizedQuery) score += 300
  if (fileName.startsWith(normalizedQuery)) score += 180
  if (normalizedPath.startsWith(normalizedQuery)) score += 120
  if (fileName.includes(normalizedQuery)) score += 80
  if (normalizedPath.includes(normalizedQuery)) score += 40

  let position = -1
  let fuzzyScore = 0
  for (const char of normalizedQuery) {
    position = normalizedPath.indexOf(char, position + 1)
    if (position === -1) {
      return -1
    }
    fuzzyScore += Math.max(1, 8 - Math.min(position, 7))
  }

  return score + fuzzyScore - Math.min(60, normalizedPath.length)
}

/**
 * Builds the file index using Node's native recursive readdir.
 * Avoids per-file stat() calls -- modifiedMs is deferred to top-N results.
 */
async function buildFileIndex(root: string): Promise<FileIndex> {
  const entries: IndexedEntry[] = []
  const prefixMap = new Map<string, IndexedEntry[]>()

  try {
    const dirents = await readdir(root, { recursive: true, withFileTypes: true })

    for (const dirent of dirents) {
      if (entries.length >= MAX_INDEXED_ENTRIES) break

      // Filter ignored directories at any depth
      const parentPath = dirent.parentPath ?? ''
      const relativeDirFromRoot = parentPath
        ? path.relative(root, parentPath)
        : ''
      const segments = relativeDirFromRoot
        ? relativeDirFromRoot.split(path.sep)
        : []

      if (segments.some(segment => IGNORED_PATTERN.test(segment))) continue
      if (IGNORED_PATTERN.test(dirent.name)) continue

      const relativePath = normalizeRelativePath(
        segments.length > 0
          ? path.join(relativeDirFromRoot, dirent.name)
          : dirent.name,
      )

      const entry: IndexedEntry = {
        relativePath,
        kind: dirent.isDirectory() ? 'dir' : 'file',
        modifiedMs: 0, // deferred -- populated only for top-N results
      }

      entries.push(entry)

      // Build prefix map: group by parent directory
      const parentKey = normalizeRelativePath(relativeDirFromRoot) || '.'
      const bucket = prefixMap.get(parentKey)
      if (bucket) {
        bucket.push(entry)
      } else {
        prefixMap.set(parentKey, [entry])
      }
    }
  } catch {
    // If readdir fails (permissions, etc.), return empty index
  }

  return { root, entries, prefixMap, builtAt: Date.now() }
}

/**
 * Returns the file index for a root directory.
 * Uses stale-while-revalidate: returns cached data immediately if available,
 * even when TTL has expired, while triggering a background refresh.
 */
export async function getFileIndex(root: string): Promise<FileIndex> {
  const cached = indexCache.get(root)

  if (cached) {
    if (Date.now() - cached.builtAt < INDEX_TTL_MS) {
      return cached
    }
    // Stale-while-revalidate: return stale, refresh in background
    if (!inflightBuilds.has(root)) {
      const buildPromise = buildFileIndex(root).then(fresh => {
        indexCache.set(root, fresh)
        inflightBuilds.delete(root)
        return fresh
      })
      inflightBuilds.set(root, buildPromise)
    }
    return cached
  }

  // No cached data -- must build synchronously
  const inflight = inflightBuilds.get(root)
  if (inflight) {
    return inflight
  }

  const buildPromise = buildFileIndex(root).then(fresh => {
    indexCache.set(root, fresh)
    inflightBuilds.delete(root)
    return fresh
  })
  inflightBuilds.set(root, buildPromise)
  return buildPromise
}

/** Populates modifiedMs lazily for the given entries. */
async function fillModifiedMs(root: string, entries: IndexedEntry[]): Promise<void> {
  const pending = entries.filter(e => e.modifiedMs === 0)
  await Promise.all(
    pending.map(async entry => {
      try {
        const stats = await stat(path.join(root, entry.relativePath))
        entry.modifiedMs = stats.mtimeMs
      } catch {
        // leave as 0 if stat fails
      }
    }),
  )
}

export async function searchIndexedFiles(args: {
  root: string
  query?: string
  relativeBase?: string
}): Promise<IndexedEntry[]> {
  const index = await getFileIndex(args.root)
  const normalizedBase = args.relativeBase
    ? normalizeRelativePath(args.relativeBase).replace(/\/+$/, '')
    : ''

  // Use prefix map for O(1) subtree lookup when possible
  let entries: IndexedEntry[]
  if (normalizedBase) {
    const direct = index.prefixMap.get(normalizedBase) ?? []
    // Also include entries from deeper subdirectories
    const deeper: IndexedEntry[] = []
    for (const [key, bucket] of index.prefixMap) {
      if (key.startsWith(`${normalizedBase}/`)) {
        deeper.push(...bucket)
      }
    }
    entries = [...direct, ...deeper]
  } else {
    entries = index.entries
  }

  if (!args.query?.trim()) {
    return entries
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .slice(0, MAX_LIST_FILES_RESULTS)
  }

  const scored = entries
    .map(entry => ({
      entry,
      score: scoreEntry(entry.relativePath, args.query!),
      frecency: getFrecencyScore(entry.relativePath),
    }))
    .filter(item => item.score >= 0)
    .sort((a, b) => {
      const totalA = a.score + a.frecency
      const totalB = b.score + b.frecency
      if (totalB !== totalA) return totalB - totalA
      return a.entry.relativePath.localeCompare(b.entry.relativePath)
    })
    .slice(0, MAX_LIST_FILES_RESULTS)

  // Populate modifiedMs only for the top results that need it
  const topEntries = scored.map(item => item.entry)
  await fillModifiedMs(args.root, topEntries)

  return topEntries
}

export function clearFileIndexCache(): void {
  indexCache.clear()
  inflightBuilds.clear()
}

/** Invalidate the index only for a specific root directory. */
export function invalidateFileIndex(root: string): void {
  indexCache.delete(root)
  inflightBuilds.delete(root)
}
