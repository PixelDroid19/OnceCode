/**
 * Frecency scoring for file search: frequency + recency.
 *
 * Tracks how often and how recently files are accessed, boosting
 * frequently-used files in search results. Inspired by fff-bun's
 * frecency ranking system.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

type FrecencyRecord = {
  count: number
  lastAccessMs: number
}

type FrecencyStore = {
  entries: Record<string, FrecencyRecord>
  version: number
}

/** Weight of recency vs frequency in the final score. */
const RECENCY_WEIGHT = 0.6
const FREQUENCY_WEIGHT = 0.4

/** Recency half-life: files accessed this many ms ago score half as much. */
const RECENCY_HALF_LIFE_MS = 24 * 60 * 60 * 1_000 // 24 hours

/** Maximum entries kept in store to prevent unbounded growth. */
const MAX_FRECENCY_ENTRIES = 2_000

/** In-memory frecency state. */
let store: FrecencyStore = { entries: {}, version: 1 }
let storePath: string | null = null
let dirty = false

/**
 * Initialize frecency tracking with a persistent storage path.
 * If omitted, frecency works in-memory only (no persistence).
 */
export async function initFrecency(dataDir?: string): Promise<void> {
  if (!dataDir) return

  storePath = path.join(dataDir, 'frecency.json')
  try {
    await mkdir(path.dirname(storePath), { recursive: true })
    const raw = await readFile(storePath, 'utf-8')
    const parsed = JSON.parse(raw) as FrecencyStore
    if (parsed.version === 1 && typeof parsed.entries === 'object') {
      store = parsed
    }
  } catch {
    // No existing store or invalid -- start fresh
  }
}

/** Record that a file was accessed (opened, read, edited). */
export function trackFileAccess(relativePath: string): void {
  const normalized = relativePath.replace(/[\\/]+/g, '/')
  const existing = store.entries[normalized]
  store.entries[normalized] = {
    count: (existing?.count ?? 0) + 1,
    lastAccessMs: Date.now(),
  }
  dirty = true
  pruneIfNeeded()
}

/**
 * Get a frecency boost score for a file path.
 * Returns 0 for unknown files, higher values for frequently/recently accessed.
 */
export function getFrecencyScore(relativePath: string): number {
  const normalized = relativePath.replace(/[\\/]+/g, '/')
  const record = store.entries[normalized]
  if (!record) return 0

  const ageMs = Math.max(0, Date.now() - record.lastAccessMs)
  const recencyScore = Math.exp((-ageMs * Math.LN2) / RECENCY_HALF_LIFE_MS)
  const frequencyScore = Math.log2(record.count + 1)

  return RECENCY_WEIGHT * recencyScore * 100 + FREQUENCY_WEIGHT * frequencyScore * 50
}

/** Persist frecency data to disk (call periodically or on exit). */
export async function saveFrecency(): Promise<void> {
  if (!storePath || !dirty) return

  try {
    await writeFile(storePath, JSON.stringify(store), 'utf-8')
    dirty = false
  } catch {
    // Silently fail -- frecency is non-critical
  }
}

/** Prune oldest entries if we exceed the max. */
function pruneIfNeeded(): void {
  const keys = Object.keys(store.entries)
  if (keys.length <= MAX_FRECENCY_ENTRIES) return

  // Sort by lastAccessMs ascending, remove oldest
  const sorted = keys
    .map(key => ({ key, lastAccessMs: store.entries[key].lastAccessMs }))
    .sort((a, b) => a.lastAccessMs - b.lastAccessMs)

  const toRemove = sorted.slice(0, keys.length - MAX_FRECENCY_ENTRIES)
  for (const { key } of toRemove) {
    delete store.entries[key]
  }
}

/** Reset frecency data (useful for tests). */
export function resetFrecency(): void {
  store = { entries: {}, version: 1 }
  storePath = null
  dirty = false
}
