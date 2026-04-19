/**
 * Shared HTTP infrastructure for model adapters.
 *
 * Consolidates auth header construction, gzip compression, retry with
 * exponential backoff, and HTTP error classification — logic that was
 * previously duplicated across every adapter.
 */

import { gzipSync } from 'node:zlib'
import type { RuntimeProviderConfig } from '@/config/runtime.js'
import {
  extractErrorMessage,
  parseRetryAfterMs,
  readJsonBody,
} from '@/utils/http.js'
import {
  AuthError,
  NetworkError,
  RateLimitError,
  UnknownError,
  exponentialRetrySchedule,
  withRetry,
} from '@/utils/result.js'

const MAX_RETRIES = 4
const GZIP_THRESHOLD = 4_096

function retries(): number {
  const value = Number(process.env.ONCECODE_MAX_RETRIES)
  if (!Number.isFinite(value) || value < 0) return MAX_RETRIES
  return Math.floor(value)
}

/**
 * Maps an HTTP status code to the appropriate typed error class.
 *
 * - 401/403 → `AuthError`
 * - 429 → `RateLimitError` (with optional `retryAfterMs`)
 * - 5xx → `NetworkError` (transient, retryable)
 * - everything else → `UnknownError`
 */
export function classify(args: {
  status?: number
  message: string
  retryAfterMs?: number | null
}): Error {
  if (args.status === 401 || args.status === 403) return new AuthError(args.message)
  if (args.status === 429) return new RateLimitError(args.message, args.retryAfterMs ?? undefined)
  if (args.status !== undefined && args.status >= 500 && args.status < 600) return new NetworkError(args.message)
  return new UnknownError(args.message)
}

/**
 * Executes a POST request with automatic auth, optional gzip, retry, and
 * error classification.
 *
 * @param opts.url      - Target endpoint (query auth is appended automatically)
 * @param opts.provider - Runtime provider config (auth type, credentials, etc.)
 * @param opts.body     - JSON string to send as the request body
 * @param opts.extra    - Additional headers (e.g. `{ 'anthropic-version': '2023-06-01' }`)
 * @param opts.signal   - Optional `AbortSignal` for cancellation
 * @param opts.gzip     - Enable gzip for bodies over 4 KiB (default `true`)
 * @returns The successful `Response` object
 * @throws {AuthError | RateLimitError | NetworkError | UnknownError}
 */
export async function post(opts: {
  url: string | URL
  provider: RuntimeProviderConfig
  body: string
  extra?: Record<string, string>
  signal?: AbortSignal
  gzip?: boolean
}): Promise<Response> {
  const url = new URL(typeof opts.url === 'string' ? opts.url : opts.url.toString())
  if (opts.provider.auth.type === 'query' && opts.provider.auth.name) {
    url.searchParams.set(opts.provider.auth.name, opts.provider.auth.value)
  }

  const hdrs: Record<string, string> = { 'content-type': 'application/json', ...opts.extra }
  if (opts.provider.auth.type === 'bearer') {
    hdrs.Authorization = `Bearer ${opts.provider.auth.value}`
  }
  if (opts.provider.auth.type === 'header' && opts.provider.auth.name) {
    hdrs[opts.provider.auth.name] = opts.provider.auth.value
  }

  const useGzip = opts.gzip !== false && opts.body.length > GZIP_THRESHOLD
  const payload = useGzip ? gzipSync(opts.body) : opts.body
  if (useGzip) hdrs['content-encoding'] = 'gzip'

  const schedule = exponentialRetrySchedule({
    maxRetries: retries(),
    baseDelayMs: 500,
    maxDelayMs: 8_000,
  })

  return withRetry(async () => {
    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: hdrs,
        body: payload,
        signal: opts.signal,
      })
    } catch (error) {
      if (error instanceof Error) throw new NetworkError(error.message)
      throw new UnknownError(error)
    }
    if (response.ok) return response
    const data = await readJsonBody(response)
    throw classify({
      status: response.status,
      message: extractErrorMessage(data, response.status),
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
    })
  }, schedule)
}
