import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { setEnv } from '../helpers/env.js'
import { importFresh } from '../helpers/module.js'

describe('skills', () => {
  let homeDir = ''
  let cwdDir = ''

  afterEach(async () => {
    if (cwdDir) {
      await removeTempDir(cwdDir)
      cwdDir = ''
    }
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('discovers project and user skills with project precedence', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir })

    const projectSkillDir = path.join(cwdDir, '.oncecode', 'skills', 'frontend')
    const userSkillDir = path.join(homeDir, '.oncecode', 'skills', 'frontend')
    await mkdir(projectSkillDir, { recursive: true })
    await mkdir(userSkillDir, { recursive: true })
    await writeFile(path.join(projectSkillDir, 'SKILL.md'), '# Frontend\n\nProject skill desc')
    await writeFile(path.join(userSkillDir, 'SKILL.md'), '# Frontend\n\nUser skill desc')

    const skills = await importFresh<typeof import('@/session/skills.js')>(
      '@/session/skills.js', import.meta.url,
    )

    const discovered = await skills.discoverSkills(cwdDir)
    expect(discovered).toHaveLength(1)
    expect(discovered[0]).toMatchObject({
      name: 'frontend',
      description: 'Project skill desc',
      source: 'project',
    })
  })

  it('loads a named skill', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir })
    const skillDir = path.join(cwdDir, '.oncecode', 'skills', 'backend')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Backend\n\nBuild APIs')

    const skills = await importFresh<typeof import('@/session/skills.js')>(
      '@/session/skills.js', import.meta.url,
    )
    await expect(skills.loadSkill(cwdDir, 'backend')).resolves.toMatchObject({
      name: 'backend',
      source: 'project',
      description: 'Build APIs',
    })
  })

  it('installs and removes managed skills', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir })
    const sourceDir = path.join(cwdDir, 'sample-skill')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(path.join(sourceDir, 'SKILL.md'), '# Sample\n\nReusable flow')

    const skills = await importFresh<typeof import('@/session/skills.js')>(
      '@/session/skills.js', import.meta.url,
    )
    const installed = await skills.installSkill({
      cwd: cwdDir,
      sourcePath: sourceDir,
      name: 'sample',
      scope: 'project',
    })
    expect(await readFile(installed.targetPath, 'utf8')).toContain('Reusable flow')

    const removed = await skills.removeManagedSkill({
      cwd: cwdDir,
      name: 'sample',
      scope: 'project',
    })
    expect(removed.removed).toBe(true)
  })
})
