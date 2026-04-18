import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLoadSkillTool } from '@/tools/load-skill.js'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { setEnv } from '../helpers/env.js'

describe('tools/load-skill', () => {
  let dir = ''
  let homeDir = ''

  afterEach(async () => {
    if (dir) {
      await removeTempDir(dir)
      dir = ''
    }
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('loads installed skill content', async () => {
    dir = await makeTempDir('oncecode-load-skill')
    homeDir = await makeTempDir('oncecode-home')
    setEnv({ HOME: homeDir })
    const skillDir = path.join(dir, '.oncecode', 'skills', 'frontend')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Frontend\n\nUse design system')

    const tool = createLoadSkillTool(dir)
    const result = await tool.run({ name: 'frontend' }, { cwd: dir })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('SKILL: frontend')
    expect(result.output).toContain('Use design system')
  })

  it('returns not found errors for unknown skills', async () => {
    dir = await makeTempDir('oncecode-load-skill')
    const tool = createLoadSkillTool(dir)
    const result = await tool.run({ name: 'missing' }, { cwd: dir })
    expect(result).toEqual({ ok: false, output: 'Unknown skill: missing' })
  })
})
