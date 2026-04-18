import { describe, expect, it } from 'vitest'
import {
  ok,
  err,
  tryAsync,
  trySync,
  RateLimitError,
  AuthError,
  NetworkError,
  TimeoutError,
  ToolExecutionError,
  FileNotFoundError,
  ValidationError,
  CompactionError,
  AbortedError,
  UnknownError,
  isAppError,
  isRetryable,
  exponentialRetrySchedule,
  withRetry,
} from '@/utils/result'

describe('ok / err constructors', () => {
  it('ok wraps a value', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    expect(r.value).toBe(42)
  })

  it('err wraps an error', () => {
    const r = err('bad')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('bad')
  })

  it('discriminates via ok field', () => {
    const r = ok('hello') as ReturnType<typeof ok<string>> | ReturnType<typeof err<string>>
    if (r.ok) {
      expect(r.value).toBe('hello')
    } else {
      throw new Error('should be ok')
    }
  })
})

describe('tryAsync', () => {
  it('returns ok on success', async () => {
    const r = await tryAsync(async () => 123)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(123)
  })

  it('catches AppError and wraps in err', async () => {
    const r = await tryAsync(async () => {
      throw new AuthError('no')
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error._tag).toBe('AuthError')
  })

  it('wraps non-AppError in UnknownError', async () => {
    const r = await tryAsync(async () => {
      throw new Error('plain')
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error._tag).toBe('UnknownError')
      expect(r.error.message).toBe('plain')
    }
  })
})

describe('trySync', () => {
  it('returns ok on success', () => {
    const r = trySync(() => 'hi')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('hi')
  })

  it('catches AppError', () => {
    const r = trySync(() => {
      throw new ValidationError('bad')
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error._tag).toBe('ValidationError')
  })

  it('wraps non-AppError in UnknownError', () => {
    const r = trySync(() => {
      throw 'string error'
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error._tag).toBe('UnknownError')
  })
})

describe('tagged errors', () => {
  it.each([
    { Class: RateLimitError, tag: 'RateLimitError', retryable: true, args: ['msg', 1000] as const },
    { Class: AuthError, tag: 'AuthError', retryable: false, args: ['msg'] as const },
    { Class: NetworkError, tag: 'NetworkError', retryable: true, args: ['msg'] as const },
    { Class: TimeoutError, tag: 'TimeoutError', retryable: true, args: ['msg', 5000] as const },
    { Class: ToolExecutionError, tag: 'ToolExecutionError', retryable: false, args: ['msg', 'tool'] as const },
    { Class: FileNotFoundError, tag: 'FileNotFoundError', retryable: false, args: ['msg', '/a'] as const },
    { Class: ValidationError, tag: 'ValidationError', retryable: false, args: ['msg'] as const },
    { Class: CompactionError, tag: 'CompactionError', retryable: true, args: ['msg'] as const },
    { Class: AbortedError, tag: 'AbortedError', retryable: false, args: ['msg'] as const },
  ])('$tag has correct _tag and retryable=$retryable', ({ Class, tag, retryable, args }) => {
    const e = new (Class as any)(...args)
    expect(e._tag).toBe(tag)
    expect(e.retryable).toBe(retryable)
    expect(isAppError(e)).toBe(true)
  })

  it('UnknownError wraps cause', () => {
    const cause = new TypeError('oops')
    const e = new UnknownError(cause)
    expect(e._tag).toBe('UnknownError')
    expect(e.cause).toBe(cause)
    expect(e.message).toBe('oops')
    expect(e.retryable).toBe(false)
  })
})

describe('isRetryable', () => {
  it('returns true for retryable errors', () => {
    expect(isRetryable(new RateLimitError('r'))).toBe(true)
    expect(isRetryable(new NetworkError('n'))).toBe(true)
    expect(isRetryable(new TimeoutError('t', 1000))).toBe(true)
    expect(isRetryable(new CompactionError('c'))).toBe(true)
  })

  it('returns false for non-retryable errors', () => {
    expect(isRetryable(new AuthError('a'))).toBe(false)
    expect(isRetryable(new ValidationError('v'))).toBe(false)
    expect(isRetryable(new ToolExecutionError('t', 'x'))).toBe(false)
  })

  it('returns false for non-AppError', () => {
    expect(isRetryable(new Error('plain'))).toBe(false)
    expect(isRetryable('string')).toBe(false)
  })
})

describe('exponentialRetrySchedule', () => {
  it('respects maxRetries', () => {
    const schedule = exponentialRetrySchedule({ maxRetries: 2 })
    const retryableErr = new NetworkError('fail')
    expect(schedule(0, retryableErr).shouldRetry).toBe(true)
    expect(schedule(1, retryableErr).shouldRetry).toBe(true)
    expect(schedule(2, retryableErr).shouldRetry).toBe(false)
  })

  it('rejects non-retryable errors', () => {
    const schedule = exponentialRetrySchedule({ maxRetries: 5 })
    expect(schedule(0, new AuthError('no')).shouldRetry).toBe(false)
  })

  it('respects custom isRetryable filter', () => {
    const schedule = exponentialRetrySchedule({
      maxRetries: 3,
      isRetryable: () => true,
    })
    expect(schedule(0, new Error('anything')).shouldRetry).toBe(true)
  })

  it('honors RateLimitError.retryAfterMs', () => {
    const schedule = exponentialRetrySchedule({ maxRetries: 3 })
    const rle = new RateLimitError('slow down', 5000)
    const decision = schedule(0, rle)
    expect(decision.shouldRetry).toBe(true)
    expect(decision.delayMs).toBe(5000)
  })

  it('uses exponential backoff for non-rate-limit errors', () => {
    const schedule = exponentialRetrySchedule({ baseDelayMs: 100, maxRetries: 3 })
    const d0 = schedule(0, new NetworkError('n'))
    const d1 = schedule(1, new NetworkError('n'))
    // attempt 0: base=100, attempt 1: base=200 (before jitter)
    expect(d0.delayMs).toBeGreaterThanOrEqual(100)
    expect(d0.delayMs).toBeLessThanOrEqual(125) // 100 + 25% jitter
    expect(d1.delayMs).toBeGreaterThanOrEqual(200)
    expect(d1.delayMs).toBeLessThanOrEqual(250)
  })
})

describe('withRetry', () => {
  it('succeeds after transient failures', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      if (calls < 3) throw new NetworkError('fail')
      return 'done'
    }, exponentialRetrySchedule({ maxRetries: 5, baseDelayMs: 0 }))
    expect(result).toBe('done')
    expect(calls).toBe(3)
  })

  it('gives up after maxRetries', async () => {
    let calls = 0
    await expect(
      withRetry(async () => {
        calls++
        throw new NetworkError('fail')
      }, exponentialRetrySchedule({ maxRetries: 2, baseDelayMs: 0 })),
    ).rejects.toThrow('fail')
    // attempt 0 -> retry, attempt 1 -> retry, attempt 2 -> give up = 3 calls
    expect(calls).toBe(3)
  })

  it('does not retry non-retryable errors', async () => {
    let calls = 0
    await expect(
      withRetry(async () => {
        calls++
        throw new AuthError('no')
      }, exponentialRetrySchedule({ maxRetries: 5, baseDelayMs: 0 })),
    ).rejects.toThrow('no')
    expect(calls).toBe(1)
  })
})
