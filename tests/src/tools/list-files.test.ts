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

  it('indexes nested files recursively and supports fuzzy query ranking', async () => {
    dir = await makeTempDir('oncecode-list-files-fuzzy')
    await mkdir(path.join(dir, 'src', 'deep'), { recursive: true })
    await writeFile(path.join(dir, 'src', 'main.ts'), 'export {}')
    await writeFile(path.join(dir, 'src', 'deep', 'feature-main.ts'), 'export {}')
    await writeFile(path.join(dir, 'README.md'), 'hello')

    const result = await listFilesTool.run({ query: 'main' }, { cwd: dir })
    expect(result.ok).toBe(true)
    const lines = result.output.split('\n')
    expect(lines[0]).toContain('src/main.ts')
    expect(result.output).toContain('src/deep/feature-main.ts')
  })

  it('restricts search to the requested subtree', async () => {
    dir = await makeTempDir('oncecode-list-files-subtree')
    await mkdir(path.join(dir, 'src', 'deep'), { recursive: true })
    await mkdir(path.join(dir, 'docs'), { recursive: true })
    await writeFile(path.join(dir, 'src', 'deep', 'main.ts'), 'export {}')
    await writeFile(path.join(dir, 'docs', 'main.md'), '# doc')

    const result = await listFilesTool.run({ path: 'src', query: 'main' }, { cwd: dir })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('src/deep/main.ts')
    expect(result.output).not.toContain('docs/main.md')
  })
})
