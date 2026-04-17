import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { patchFileTool } from '../../../src/tools/patch-file.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('tools/patch-file', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('applies multiple replacements', async () => {
    dir = await makeTempDir('oncecode-patch-file')
    await writeFile(path.join(dir, 'notes.txt'), 'hello world\nfoo bar')
    const ensureEdit = vi.fn(async () => {})
    const ensurePathAccess = vi.fn(async () => {})
    const result = await patchFileTool.run(
      {
        path: 'notes.txt',
        replacements: [
          { search: 'world', replace: 'team' },
          { search: 'foo', replace: 'baz' },
        ],
      },
      { cwd: dir, permissions: { ensureEdit, ensurePathAccess } as never },
    )
    expect(result.ok).toBe(true)
    expect(result.output).toContain('2 replacement(s)')
  })

  it('fails when a replacement is missing', async () => {
    dir = await makeTempDir('oncecode-patch-file')
    await writeFile(path.join(dir, 'notes.txt'), 'hello world')
    const result = await patchFileTool.run(
      {
        path: 'notes.txt',
        replacements: [{ search: 'missing', replace: 'team' }],
      },
      { cwd: dir },
    )
    expect(result).toEqual({ ok: false, output: 'Replacement 1 not found in notes.txt' })
  })
})
