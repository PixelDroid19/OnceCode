import { describe, expect, it } from 'vitest'
import { createChildController, isAbortError, timeoutSignal } from '@/utils/abort'

describe('createChildController', () => {
  it('child aborts when parent aborts', () => {
    const parent = new AbortController()
    const child = createChildController(parent.signal)
    expect(child.signal.aborted).toBe(false)
    parent.abort('parent reason')
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('parent reason')
  })

  it('child can abort independently without affecting parent', () => {
    const parent = new AbortController()
    const child = createChildController(parent.signal)
    child.abort('child reason')
    expect(child.signal.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  it('returns a standalone controller when no parent signal', () => {
    const child = createChildController()
    expect(child.signal.aborted).toBe(false)
    child.abort()
    expect(child.signal.aborted).toBe(true)
  })

  it('creates already-aborted child when parent is already aborted', () => {
    const parent = new AbortController()
    parent.abort('already')
    const child = createChildController(parent.signal)
    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('already')
  })
})

describe('isAbortError', () => {
  it('detects DOMException with AbortError name', () => {
    const err = new DOMException('aborted', 'AbortError')
    expect(isAbortError(err)).toBe(true)
  })

  it('detects Error with name AbortError', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
  })

  it('detects objects with code ABORT_ERR', () => {
    expect(isAbortError({ code: 'ABORT_ERR' })).toBe(true)
  })

  it('returns false for regular errors', () => {
    expect(isAbortError(new Error('nope'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('string')).toBe(false)
  })
})

describe('timeoutSignal', () => {
  it('returns an AbortSignal', () => {
    const signal = timeoutSignal(10000)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
  })

  it('aborts when parent aborts before timeout', () => {
    const parent = new AbortController()
    const signal = timeoutSignal(60000, parent.signal)
    parent.abort('cancel')
    expect(signal.aborted).toBe(true)
  })
})
