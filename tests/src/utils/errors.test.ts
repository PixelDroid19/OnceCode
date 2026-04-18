import { describe, expect, it } from 'vitest'
import { getErrorCode, isEnoentError } from '@/utils/errors.js'

describe('utils/errors', () => {
  it('extracts a direct error code', () => {
    expect(getErrorCode({ code: 'ENOENT' })).toBe('ENOENT')
  })

  it('extracts a nested cause code from Error', () => {
    const error = new Error('boom', { cause: { code: 'ECONNRESET' } })
    expect(getErrorCode(error)).toBe('ECONNRESET')
  })

  it('returns null when code is unavailable', () => {
    expect(getErrorCode('boom')).toBeNull()
  })

  it('detects ENOENT errors', () => {
    expect(isEnoentError({ code: 'ENOENT' })).toBe(true)
    expect(isEnoentError({ code: 'EACCES' })).toBe(false)
  })
})
