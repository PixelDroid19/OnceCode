/**
 * Structured cancellation via AbortController trees.
 *
 * When a parent controller aborts, all children automatically abort.
 * This ensures no orphaned work when the user cancels or the session ends.
 */

/**
 * Creates a child AbortController whose abort is triggered by either
 * the parent signal or a direct call to the child's abort().
 */
export function createChildController(parentSignal?: AbortSignal): AbortController {
  const child = new AbortController()

  if (!parentSignal) return child

  if (parentSignal.aborted) {
    child.abort(parentSignal.reason)
    return child
  }

  const onParentAbort = () => {
    child.abort(parentSignal.reason)
  }
  parentSignal.addEventListener('abort', onParentAbort, { once: true })

  // Clean up the listener if the child aborts independently
  child.signal.addEventListener('abort', () => {
    parentSignal.removeEventListener('abort', onParentAbort)
  }, { once: true })

  return child
}

/**
 * Checks if an error was caused by an abort signal.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ABORT_ERR'
  ) {
    return true
  }
  return false
}

/**
 * Creates an AbortSignal that aborts after the given timeout,
 * or when the parent signal aborts -- whichever comes first.
 */
export function timeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
  const child = createChildController(parentSignal)
  const timer = setTimeout(() => child.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)

  child.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })

  return child.signal
}
