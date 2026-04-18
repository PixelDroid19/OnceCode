import { readFile } from 'node:fs/promises'
import { isEnoentError } from './errors.js'

/** Reads a text file, returning null instead of throwing on ENOENT. */
export async function readTextFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isEnoentError(error)) {
      return null
    }

    throw error
  }
}
