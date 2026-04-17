import { describe, expect, it } from 'vitest'
import {
  getModelMaxOutputTokens,
  resolveMaxOutputTokens,
} from '../../../src/utils/context.js'

describe('utils/context', () => {
  it('matches known models', () => {
    expect(getModelMaxOutputTokens('claude-sonnet-4-6')).toEqual({
      default: 64_000,
      upperLimit: 64_000,
    })
  })

  it('falls back for unknown models', () => {
    expect(getModelMaxOutputTokens('custom-model')).toEqual({
      default: 32_000,
      upperLimit: 64_000,
    })
  })

  it('caps configured max tokens to model upper limit', () => {
    expect(resolveMaxOutputTokens('gpt-4o', 99_999)).toBe(16_384)
  })

  it('uses default when configured value is invalid', () => {
    expect(resolveMaxOutputTokens('gpt-4o')).toBe(16_384)
    expect(resolveMaxOutputTokens('gpt-4o', -1)).toBe(16_384)
  })
})
