import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { ONCECODE_DIR, ONCECODE_PERMISSIONS_PATH } from '@/config/store.js'
import { isEnoentError } from '@/utils/errors.js'

export type PermissionStore = {
  allowedDirectoryPrefixes?: string[]
  deniedDirectoryPrefixes?: string[]
  allowedCommandPatterns?: string[]
  deniedCommandPatterns?: string[]
  allowedEditPatterns?: string[]
  deniedEditPatterns?: string[]
}

const PERMISSIONS_PATH = ONCECODE_PERMISSIONS_PATH

export async function readPermissionStore(): Promise<PermissionStore> {
  try {
    const content = await readFile(PERMISSIONS_PATH, 'utf8')
    return JSON.parse(content) as PermissionStore
  } catch (error) {
    if (isEnoentError(error)) {
      return {}
    }

    throw error
  }
}

export async function writePermissionStore(store: PermissionStore): Promise<void> {
  await mkdir(ONCECODE_DIR, { recursive: true })
  await writeFile(PERMISSIONS_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

export function getPermissionsPath(): string {
  return PERMISSIONS_PATH
}
