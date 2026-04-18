import { clearFileIndexCache } from '@/tools/file-index.js'

type CacheEntry<T> = {
  value: T
  createdAt: number
}

/**
 * Extracted cache component for tool results.
 * Handles TTL expiration, concurrent lookup dedup, and
 * automatic invalidation when mutating operations occur.
 */
export class ToolCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly inflight = new Map<string, Promise<T>>()

  constructor(
    private readonly ttlMs: number = 2_000,
    private readonly maxEntries: number = 64,
  ) {}

  /** Get a cached value, or null if expired/missing. */
  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (!entry) return null

    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key)
      return null
    }

    return entry.value
  }

  /** Store a value in the cache. */
  set(key: string, value: T): void {
    this.entries.set(key, { value, createdAt: Date.now() })

    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey) {
        this.entries.delete(oldestKey)
      }
    }
  }

  /** Check if there's an in-flight lookup for this key. */
  getInflight(key: string): Promise<T> | null {
    return this.inflight.get(key) ?? null
  }

  /** Register an in-flight lookup for concurrent dedup. */
  setInflight(key: string, promise: Promise<T>): void {
    this.inflight.set(key, promise)
  }

  /** Remove an in-flight tracking entry. */
  clearInflight(key: string): void {
    this.inflight.delete(key)
  }

  /** Clear all cached entries and in-flight trackers. */
  clear(): void {
    this.entries.clear()
    this.inflight.clear()
  }

  /**
   * Invalidate caches after a mutating operation.
   * Clears both the tool result cache and the file index cache.
   */
  invalidateAfterMutation(): void {
    this.clear()
    clearFileIndexCache()
  }

  /** Number of currently cached entries. */
  get size(): number {
    return this.entries.size
  }
}
