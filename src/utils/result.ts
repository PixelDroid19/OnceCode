/**
 * Lightweight Result type inspired by Effect's typed error channels.
 *
 * Provides a discriminated union for explicit success/failure without exceptions.
 * All error classes use a `_tag` literal for exhaustive switch matching.
 */

// ── Result type ────────────────────────────────────────────────────

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E = AppError> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

/** Wraps a promise in a Result, catching thrown errors. */
export async function tryAsync<T>(
  fn: () => Promise<T>,
): Promise<Result<T, AppError>> {
  try {
    return ok(await fn())
  } catch (error) {
    if (isAppError(error)) {
      return err(error)
    }
    return err(new UnknownError(error))
  }
}

/** Wraps a sync function in a Result, catching thrown errors. */
export function trySync<T>(fn: () => T): Result<T, AppError> {
  try {
    return ok(fn())
  } catch (error) {
    if (isAppError(error)) {
      return err(error)
    }
    return err(new UnknownError(error))
  }
}

// ── Tagged error hierarchy ─────────────────────────────────────────

export type ErrorTag =
  | 'RateLimitError'
  | 'AuthError'
  | 'NetworkError'
  | 'TimeoutError'
  | 'ToolExecutionError'
  | 'FileNotFoundError'
  | 'ValidationError'
  | 'CompactionError'
  | 'AbortedError'
  | 'UnknownError'

export abstract class AppError extends Error {
  abstract readonly _tag: ErrorTag

  /** Whether this error is transient and the operation can be retried. */
  get retryable(): boolean {
    return false
  }
}

export class RateLimitError extends AppError {
  readonly _tag = 'RateLimitError' as const
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }

  override get retryable(): boolean {
    return true
  }
}

export class AuthError extends AppError {
  readonly _tag = 'AuthError' as const
}

export class NetworkError extends AppError {
  readonly _tag = 'NetworkError' as const
  override get retryable(): boolean {
    return true
  }
}

export class TimeoutError extends AppError {
  readonly _tag = 'TimeoutError' as const
  constructor(
    message: string,
    readonly timeoutMs: number,
  ) {
    super(message)
  }

  override get retryable(): boolean {
    return true
  }
}

export class ToolExecutionError extends AppError {
  readonly _tag = 'ToolExecutionError' as const
  constructor(
    message: string,
    readonly toolName: string,
  ) {
    super(message)
  }
}

export class FileNotFoundError extends AppError {
  readonly _tag = 'FileNotFoundError' as const
  constructor(
    message: string,
    readonly filePath: string,
  ) {
    super(message)
  }
}

export class ValidationError extends AppError {
  readonly _tag = 'ValidationError' as const
}

export class CompactionError extends AppError {
  readonly _tag = 'CompactionError' as const
  override get retryable(): boolean {
    return true
  }
}

export class AbortedError extends AppError {
  readonly _tag = 'AbortedError' as const
}

export class UnknownError extends AppError {
  readonly _tag = 'UnknownError' as const
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/** Checks whether an error is retryable (transient). */
export function isRetryable(error: unknown): boolean {
  if (isAppError(error)) {
    return error.retryable
  }
  return false
}

// ── Retry schedule ─────────────────────────────────────────────────

export type RetryDecision = {
  shouldRetry: boolean
  delayMs: number
}

export type RetrySchedule = (attempt: number, error: unknown) => RetryDecision

/** Exponential backoff with jitter, only retrying transient errors. */
export function exponentialRetrySchedule(opts?: {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  isRetryable?: (error: unknown) => boolean
}): RetrySchedule {
  const maxRetries = opts?.maxRetries ?? 3
  const baseDelayMs = opts?.baseDelayMs ?? 500
  const maxDelayMs = opts?.maxDelayMs ?? 8_000
  const canRetry = opts?.isRetryable ?? isRetryable

  return (attempt: number, error: unknown): RetryDecision => {
    if (attempt >= maxRetries || !canRetry(error)) {
      return { shouldRetry: false, delayMs: 0 }
    }

    // Honor Retry-After from rate limit errors
    if (isAppError(error) && error._tag === 'RateLimitError') {
      const rle = error as RateLimitError
      if (rle.retryAfterMs != null) {
        return { shouldRetry: true, delayMs: rle.retryAfterMs }
      }
    }

    const base = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
    const jitter = Math.random() * 0.25 * base
    return { shouldRetry: true, delayMs: Math.floor(base + jitter) }
  }
}

/** Runs an async function with retries according to a schedule. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  schedule: RetrySchedule,
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (error) {
      const decision = schedule(attempt, error)
      if (!decision.shouldRetry) {
        throw error
      }
      attempt += 1
      if (decision.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, decision.delayMs))
      }
    }
  }
}
