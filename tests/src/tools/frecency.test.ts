import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  trackFileAccess,
  getFrecencyScore,
  resetFrecency,
} from '@/tools/frecency'

describe('frecency', () => {
  beforeEach(() => {
    resetFrecency()
    vi.useRealTimers()
  })

  it('returns 0 for an unknown file', () => {
    expect(getFrecencyScore('src/unknown.ts')).toBe(0)
  })

  it('returns a positive score after tracking access', () => {
    trackFileAccess('src/index.ts')
    expect(getFrecencyScore('src/index.ts')).toBeGreaterThan(0)
  })

  it('increases score with multiple accesses', () => {
    trackFileAccess('src/app.ts')
    const scoreAfterOne = getFrecencyScore('src/app.ts')

    trackFileAccess('src/app.ts')
    const scoreAfterTwo = getFrecencyScore('src/app.ts')

    expect(scoreAfterTwo).toBeGreaterThan(scoreAfterOne)
  })

  it('scores recently accessed files higher than old ones', () => {
    vi.useFakeTimers()

    trackFileAccess('src/old.ts')
    // Advance 48 hours (two half-lives)
    vi.advanceTimersByTime(48 * 60 * 60 * 1_000)

    trackFileAccess('src/new.ts')

    const oldScore = getFrecencyScore('src/old.ts')
    const newScore = getFrecencyScore('src/new.ts')

    expect(newScore).toBeGreaterThan(oldScore)
  })

  it('clears all data on resetFrecency', () => {
    trackFileAccess('src/a.ts')
    trackFileAccess('src/b.ts')
    resetFrecency()

    expect(getFrecencyScore('src/a.ts')).toBe(0)
    expect(getFrecencyScore('src/b.ts')).toBe(0)
  })

  it('normalizes paths to forward slashes', () => {
    trackFileAccess('src\\utils\\helper.ts')
    expect(getFrecencyScore('src/utils/helper.ts')).toBeGreaterThan(0)
  })
})
