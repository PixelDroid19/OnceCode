import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { runTsxEntry } from './helpers/cli.js'

describe('install entrypoint', () => {
  let homeDir = ''

  afterEach(async () => {
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('writes settings and installs a launcher through the real installer flow', async () => {
    const cwd = process.cwd()
    homeDir = await makeTempDir('oncecode-install-home')
    await mkdir(path.join(homeDir, '.claude'), { recursive: true })

    const result = await runTsxEntry({
      cwd,
      entry: 'src/install.ts',
      stdin: 'demo-model\nhttps://api.example.com\nsecret-token\n',
      env: {
        HOME: homeDir,
        PATH: process.env.PATH,
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('oncecode installer')
    expect(result.stdout).toContain('Installation complete.')

    const settingsPath = path.join(homeDir, '.oncecode', 'settings.json')
    const launcherPath = path.join(homeDir, '.local', 'bin', 'oncecode')
    const settings = await readFile(settingsPath, 'utf8')
    const launcher = await readFile(launcherPath, 'utf8')

    expect(settings).toContain('demo-model')
    expect(settings).toContain('https://api.example.com')
    expect(settings).toContain('secret-token')
    expect(launcher).toContain('bin/oncecode')
  })
})
