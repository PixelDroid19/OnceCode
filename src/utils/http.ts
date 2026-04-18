/** Returns a promise that resolves after the specified delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, Math.max(0, ms))
  })
}

/** Checks if an HTTP status code is retryable (429 or 5xx). */
export function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/** Parses a Retry-After header value into milliseconds. */
export function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null
  const asSeconds = Number(retryAfter)
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.floor(asSeconds * 1000)
  }

  const at = Date.parse(retryAfter)
  if (!Number.isFinite(at)) {
    return null
  }
  return Math.max(0, at - Date.now())
}

/** Computes retry delay with exponential backoff and jitter, honoring Retry-After. */
export function getRetryDelayMs(attempt: number, retryAfterMs: number | null, options?: {
  baseDelayMs?: number
  maxDelayMs?: number
}): number {
  const baseDelayMs = options?.baseDelayMs ?? 500
  const maxDelayMs = options?.maxDelayMs ?? 8_000
  if (retryAfterMs !== null) {
    return retryAfterMs
  }
  const base = Math.min(
    baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
    maxDelayMs,
  )
  const jitter = Math.random() * 0.25 * base
  return Math.floor(base + jitter)
}

/** Safely reads and parses a JSON response body, returning a fallback on failure. */
export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return { error: { message: text.trim() } }
  }
}

/** Extracts a human-readable error message from an API error response. */
export function extractErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) {
    return data.trim()
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'object' &&
    data.error !== null &&
    'message' in data.error &&
    typeof data.error.message === 'string' &&
    data.error.message.trim()
  ) {
    return data.error.message.trim()
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string' &&
    data.error.trim()
  ) {
    return data.error.trim()
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof data.message === 'string' &&
    data.message.trim()
  ) {
    return data.message.trim()
  }

  return `Model request failed: ${status}`
}
