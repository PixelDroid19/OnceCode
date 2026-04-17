import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeFileTool } from '../../../src/tools/write-file.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('tools/write-file', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('writes reviewed files', async () => {
    dir = await makeTempDir('oncecode-write-file')
    const ensureEdit = vi.fn(async () => {})
    const ensurePathAccess = vi.fn(async () => {})
    const result = await writeFileTool.run(
      { path: 'notes.txt', content: 'hello' },
      { cwd: dir, permissions: { ensureEdit, ensurePathAccess } as never },
    )
    expect(result.ok).toBe(true)
    expect(await readFile(path.join(dir, 'notes.txt'), 'utf8')).toBe('hello')
    expect(ensureEdit).toHaveBeenCalledOnce()
  })
})
