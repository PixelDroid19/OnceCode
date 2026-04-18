import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readFileTool } from '@/tools/read-file.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('tools/read-file', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('reads files with metadata header', async () => {
    dir = await makeTempDir('oncecode-read-file')
    await writeFile(path.join(dir, 'notes.txt'), 'abcdef')
    const result = await readFileTool.run({ path: 'notes.txt', offset: 2, limit: 2 }, { cwd: dir })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('FILE: notes.txt')
    expect(result.output).toContain('cd')
  })
})
