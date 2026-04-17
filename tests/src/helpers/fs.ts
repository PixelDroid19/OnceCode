import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${prefix}-`))
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
