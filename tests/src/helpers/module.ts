import { vi } from 'vitest'

export async function importFresh<T>(path: string): Promise<T> {
  vi.resetModules()
  if (path.startsWith('.')) {
    return import(new URL(path, new URL('../', import.meta.url)).href) as Promise<T>
  }

  return import(path) as Promise<T>
}
