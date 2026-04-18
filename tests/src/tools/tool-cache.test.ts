import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ToolCache } from '@/tools/tool-cache.js'
import * as fileIndex from '@/tools/file-index.js'

vi.mock('@/tools/file-index.js', () => ({
  clearFileIndexCache: vi.fn(),
}))

describe('ToolCache', () => {
  let cache: ToolCache<string>

  beforeEach(() => {
    cache = new ToolCache<string>(1000, 3)
  })

  it('returns null for missing key', () => {
    expect(cache.get('missing')).toBeNull()
  })

  it('returns value after set', () => {
    cache.set('key', 'value')
    expect(cache.get('key')).toBe('value')
  })

  describe('TTL expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns null after TTL expires', () => {
      cache.set('key', 'value')
      expect(cache.get('key')).toBe('value')

      vi.advanceTimersByTime(1001)
      expect(cache.get('key')).toBeNull()
    })

    it('returns value before TTL expires', () => {
      cache.set('key', 'value')
      vi.advanceTimersByTime(999)
      expect(cache.get('key')).toBe('value')
    })
  })

  it('evicts oldest entry when maxEntries exceeded', () => {
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    expect(cache.size).toBe(3)

    cache.set('d', '4')
    expect(cache.size).toBe(3)
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('2')
    expect(cache.get('d')).toBe('4')
  })

  it('getInflight returns null when no inflight exists', () => {
    expect(cache.getInflight('key')).toBeNull()
  })

  it('setInflight / getInflight / clearInflight dedup concurrent lookups', async () => {
    const promise = Promise.resolve('result')
    cache.setInflight('key', promise)

    expect(cache.getInflight('key')).toBe(promise)

    cache.clearInflight('key')
    expect(cache.getInflight('key')).toBeNull()
  })

  it('clear removes all entries and inflight', () => {
    cache.set('a', '1')
    cache.set('b', '2')
    cache.setInflight('c', Promise.resolve('3'))

    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeNull()
    expect(cache.getInflight('c')).toBeNull()
  })

  it('invalidateAfterMutation clears cache and calls clearFileIndexCache', () => {
    cache.set('a', '1')
    cache.invalidateAfterMutation()

    expect(cache.size).toBe(0)
    expect(fileIndex.clearFileIndexCache).toHaveBeenCalled()
  })

  it('size returns correct count', () => {
    expect(cache.size).toBe(0)
    cache.set('a', '1')
    expect(cache.size).toBe(1)
    cache.set('b', '2')
    expect(cache.size).toBe(2)
  })
})
