import { afterEach } from 'vitest'

type Snapshot = Record<string, string | undefined>

const snapshots: Snapshot[] = []

export function setEnv(overrides: Record<string, string | undefined>): void {
  const snapshot: Snapshot = {}
  for (const [key, value] of Object.entries(overrides)) {
    snapshot[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  snapshots.push(snapshot)
}

afterEach(() => {
  while (snapshots.length > 0) {
    const snapshot = snapshots.pop()!
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})
