import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { listFilesTool } from '@/tools/list-files.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'

describe('tools/list-files', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
  })

  it('lists files and directories', async () => {
    dir = await makeTempDir('oncecode-list-files')
    await mkdir(path.join(dir, 'src'))
    await writeFile(path.join(dir, 'README.md'), 'hello')
    const result = await listFilesTool.run({}, { cwd: dir })
    expect(result.ok).toBe(true)
    expect(result.output).toMatch(/dir\s+src/)
    expect(result.output).toContain('file README.md')
  })
})
