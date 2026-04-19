import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { runTsxEntry } from '../helpers/cli.js'

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

    const result = await runTsxEntry({
      cwd,
      entry: 'src/workspace/install.ts',
      stdin: 'anthropic\ndemo-model\nhttps://api.example.com\nsecret-token\n',
      env: {
        HOME: homeDir,
        PATH: process.env.PATH,
      },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('oncecode installer')
    expect(result.stdout).toContain('Installation complete.')

    const settingsPath = path.join(homeDir, '.oncecode', 'settings.json')
    const providersPath = path.join(homeDir, '.oncecode', 'providers.json')
    const launcherPath = path.join(homeDir, '.local', 'bin', 'oncecode')
    const settings = await readFile(settingsPath, 'utf8')
    const providers = await readFile(providersPath, 'utf8')
    const launcher = await readFile(launcherPath, 'utf8')

    expect(settings).toContain('demo-model')
    expect(providers).toContain('anthropic:demo-model')
    expect(providers).toContain('https://api.example.com')
    expect(providers).toContain('secret-token')
    expect(launcher).toContain('bin/oncecode')
  })
})
