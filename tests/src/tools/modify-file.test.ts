import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { modifyFileTool } from '@/tools/modify-file.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('tools/modify-file', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('replaces file content via reviewed writes', async () => {
    dir = await makeTempDir('oncecode-modify-file')
    const ensureEdit = vi.fn(async () => {})
    const ensurePathAccess = vi.fn(async () => {})
    const result = await modifyFileTool.run(
      { path: 'notes.txt', content: 'new content' },
      { cwd: dir, permissions: { ensureEdit, ensurePathAccess } as never },
    )
    expect(result.ok).toBe(true)
    expect(await readFile(path.join(dir, 'notes.txt'), 'utf8')).toBe('new content')
  })
})
