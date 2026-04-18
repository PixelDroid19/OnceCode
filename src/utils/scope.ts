/**
 * Scope-based resource lifecycle management inspired by Effect's Scope pattern.
 *
 * A Scope collects finalizers (cleanup functions) and runs them all in
 * reverse order when closed. Child scopes propagate to parent scopes,
 * ensuring no leaked resources even on crash.
 */

export type Finalizer = () => Promise<void> | void

export type ExitStatus =
  | { readonly type: 'success' }
  | { readonly type: 'failure'; readonly error: unknown }
  | { readonly type: 'interrupted' }

/**
 * Manages resource lifecycle with guaranteed cleanup.
 * Finalizers run in reverse registration order (LIFO).
 */
export class Scope {
  private readonly finalizers: Finalizer[] = []
  private readonly children: Scope[] = []
  private closed = false

  /** Register a cleanup function to run when this scope closes. */
  addFinalizer(finalizer: Finalizer): void {
    if (this.closed) {
      throw new Error('Cannot add finalizer to closed scope')
    }
    this.finalizers.push(finalizer)
  }

  /** Create a child scope whose lifecycle is bound to this parent. */
  fork(): Scope {
    if (this.closed) {
      throw new Error('Cannot fork a closed scope')
    }
    const child = new Scope()
    this.children.push(child)
    return child
  }

  /** Whether this scope has been closed. */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Close the scope, running all finalizers in reverse order.
   * Child scopes are closed first (also in reverse order).
   * Errors from finalizers are collected but don't prevent other finalizers.
   */
  async close(status: ExitStatus = { type: 'success' }): Promise<void> {
    if (this.closed) return
    this.closed = true

    const errors: unknown[] = []

    // Close children in reverse order first
    for (let i = this.children.length - 1; i >= 0; i--) {
      try {
        await this.children[i].close(status)
      } catch (error) {
        errors.push(error)
      }
    }

    // Run own finalizers in reverse order (LIFO)
    for (let i = this.finalizers.length - 1; i >= 0; i--) {
      try {
        await this.finalizers[i]()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      const message = errors
        .map(e => (e instanceof Error ? e.message : String(e)))
        .join('; ')
      throw new Error(`Scope cleanup errors: ${message}`)
    }
  }
}

/**
 * Acquire-use-release pattern: acquires a resource, uses it, and
 * guarantees release regardless of success, failure, or interruption.
 */
export async function acquireUseRelease<T, R>(
  acquire: () => Promise<T>,
  use: (resource: T) => Promise<R>,
  release: (resource: T, status: ExitStatus) => Promise<void> | void,
): Promise<R> {
  const resource = await acquire()
  let status: ExitStatus = { type: 'success' }

  try {
    return await use(resource)
  } catch (error) {
    status = { type: 'failure', error }
    throw error
  } finally {
    await release(resource, status)
  }
}

/**
 * Convenience: run a function within a fresh scope.
 * The scope is automatically closed on completion.
 */
export async function withScope<R>(
  fn: (scope: Scope) => Promise<R>,
): Promise<R> {
  const scope = new Scope()
  let status: ExitStatus = { type: 'success' }

  try {
    return await fn(scope)
  } catch (error) {
    status = { type: 'failure', error }
    throw error
  } finally {
    await scope.close(status)
  }
}
