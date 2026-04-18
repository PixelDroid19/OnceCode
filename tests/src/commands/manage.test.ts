import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { setEnv } from '../helpers/env.js'
import { importFresh } from '../helpers/module.js'

describe('manage-cli', () => {
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

  it('handles MCP add/list/remove commands', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir })
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''))
    })
    const manage = await importFresh<typeof import('@/commands/manage.js')>(
      '@/commands/manage.js', import.meta.url,
    )

    await manage.maybeHandleManagementCommand(cwdDir, ['mcp', 'add', 'fs', '--', 'node', 'server.js'])
    await manage.maybeHandleManagementCommand(cwdDir, ['mcp', 'list'])
    await manage.maybeHandleManagementCommand(cwdDir, ['mcp', 'remove', 'fs'])

    expect(logs.some((line) => line.includes('Added MCP server fs'))).toBe(true)
    expect(logs.some((line) => line.includes('fs: node server.js'))).toBe(true)
    expect(logs.some((line) => line.includes('Removed MCP server fs'))).toBe(true)
    logSpy.mockRestore()
  })

  it('handles skills add/list/remove commands', async () => {
    homeDir = await makeTempDir('oncecode-home')
    cwdDir = await makeTempDir('oncecode-project')
    setEnv({ HOME: homeDir })
    const sourceDir = path.join(cwdDir, 'skill-source')
    await mkdir(sourceDir, { recursive: true })
    await writeFile(path.join(sourceDir, 'SKILL.md'), '# Frontend\n\nBuild UI')
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''))
    })
    const manage = await importFresh<typeof import('@/commands/manage.js')>(
      '@/commands/manage.js', import.meta.url,
    )

    await manage.maybeHandleManagementCommand(cwdDir, ['skills', 'add', sourceDir, '--name', 'frontend'])
    await manage.maybeHandleManagementCommand(cwdDir, ['skills', 'list'])
    await manage.maybeHandleManagementCommand(cwdDir, ['skills', 'remove', 'frontend'])

    expect(logs.some((line) => line.includes('Installed skill frontend'))).toBe(true)
    expect(logs.some((line) => line.includes('frontend: Build UI'))).toBe(true)
    expect(logs.some((line) => line.includes('Removed skill frontend'))).toBe(true)
    logSpy.mockRestore()
  })
})
