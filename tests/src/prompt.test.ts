import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { setEnv } from './helpers/env.js'
import { importFresh } from './helpers/module.js'

describe('prompt', () => {
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

  it('builds a system prompt with permissions, skills, mcp and CLAUDE.md files', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir })
    await mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await writeFile(path.join(homeDir, '.claude', 'CLAUDE.md'), 'Global instructions')
    await writeFile(path.join(cwdDir, 'CLAUDE.md'), 'Project instructions')

    const { buildSystemPrompt } = await importFresh<typeof import('../../src/prompt.js')>(
      '../../src/prompt.js',
    )
    const prompt = await buildSystemPrompt(cwdDir, ['cwd: test'], {
      skills: [{ name: 'frontend', description: 'Build UI', path: '/tmp', source: 'user' }],
      mcpServers: [{ name: 'fs', command: 'npx fs', status: 'connected', toolCount: 2 }],
    })

    expect(prompt).toContain('You are OnceCode')
    expect(prompt).toContain('cwd: test')
    expect(prompt).toContain('frontend: Build UI')
    expect(prompt).toContain('fs: connected, tools=2')
    expect(prompt).toContain('Global instructions')
    expect(prompt).toContain('Project instructions')
  })
})
