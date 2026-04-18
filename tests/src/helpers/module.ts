import { vi } from 'vitest'

/**
 * Re-imports a module with a fresh module cache (via vi.resetModules()).
 *
 * @param modulePath - Path to the module, resolved relative to `callerUrl`
 *   (or relative to `tests/src/` when no callerUrl is given — legacy behaviour).
 * @param callerUrl  - Pass `import.meta.url` from the calling test file so
 *   relative paths resolve correctly regardless of the test's directory depth.
 */
export async function importFresh<T>(modulePath: string, callerUrl?: string): Promise<T> {
  vi.resetModules()
  if (modulePath.startsWith('.')) {
    const base = callerUrl ?? new URL('../', import.meta.url).href
    return import(new URL(modulePath, base).href) as Promise<T>
  }

  return import(modulePath) as Promise<T>
}
