import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  applyReviewedFileChange,
  buildUnifiedDiff,
  loadExistingFile,
} from '../../src/file-review.js'
import { makeTempDir, removeTempDir } from './helpers/fs.js'

describe('file-review', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('builds compact unified diffs', () => {
    const diff = buildUnifiedDiff('a.txt', 'hello\n', 'hello world\n')
    expect(diff).toContain('--- a/a.txt')
    expect(diff).toContain('+++ b/a.txt')
    expect(diff).toContain('+hello world')
  })

  it('loads missing files as empty content', async () => {
    dir = await makeTempDir('oncecode-file-review')
    await expect(loadExistingFile(path.join(dir, 'missing.txt'))).resolves.toBe('')
  })

  it('applies approved file changes', async () => {
    dir = await makeTempDir('oncecode-file-review')
    const target = path.join(dir, 'notes.txt')
    const ensureEdit = vi.fn(async () => {})

    const result = await applyReviewedFileChange(
      {
        cwd: dir,
        permissions: { ensureEdit } as never,
      },
      'notes.txt',
      target,
      'hello world',
    )

    expect(result.ok).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('hello world')
    expect(ensureEdit).toHaveBeenCalledOnce()
  })
})
