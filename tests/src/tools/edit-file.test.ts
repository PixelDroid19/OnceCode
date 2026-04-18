import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { editFileTool } from '@/tools/edit-file.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('tools/edit-file', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('edits matching text', async () => {
    dir = await makeTempDir('oncecode-edit-file')
    await writeFile(path.join(dir, 'notes.txt'), 'hello world')
    const ensureEdit = vi.fn(async () => {})
    const ensurePathAccess = vi.fn(async () => {})
    const result = await editFileTool.run(
      { path: 'notes.txt', search: 'world', replace: 'team' },
      { cwd: dir, permissions: { ensureEdit, ensurePathAccess } as never },
    )
    expect(result.ok).toBe(true)
  })

  it('returns errors when search text is missing', async () => {
    dir = await makeTempDir('oncecode-edit-file')
    await writeFile(path.join(dir, 'notes.txt'), 'hello world')
    const result = await editFileTool.run(
      { path: 'notes.txt', search: 'missing', replace: 'team' },
      { cwd: dir },
    )
    expect(result).toEqual({ ok: false, output: 'Text not found in notes.txt' })
  })
})
