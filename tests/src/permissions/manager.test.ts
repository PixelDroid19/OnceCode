import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir, removeTempDir } from '../helpers/fs.js'
import { setEnv } from '../helpers/env.js'
import { importFresh } from '../helpers/module.js'

describe('permissions', () => {
  let homeDir = ''
  let workspaceDir = ''

  afterEach(async () => {
    if (workspaceDir) {
      await removeTempDir(workspaceDir)
      workspaceDir = ''
    }
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  async function loadPermissionsModule() {
    homeDir = await makeTempDir('oncecode-home')
    workspaceDir = await makeTempDir('oncecode-workspace')
    setEnv({ HOME: homeDir })
    await mkdir(path.join(homeDir, '.oncecode'), { recursive: true })
    return importFresh<typeof import('@/permissions/manager.js')>(
      '@/permissions/manager.js', import.meta.url,
    )
  }

  it('allows paths within the workspace', async () => {
    const permissionsModule = await loadPermissionsModule()
    const manager = new permissionsModule.PermissionManager(workspaceDir)
    await manager.whenReady()
    await expect(manager.ensurePathAccess(path.join(workspaceDir, 'src/index.ts'), 'read')).resolves.toBeUndefined()
  })

  it('prompts and persists allowed outside directory access', async () => {
    const permissionsModule = await loadPermissionsModule()
    const prompt = vi.fn(async () => ({ decision: 'allow_always' as const }))
    const manager = new permissionsModule.PermissionManager(workspaceDir, prompt)
    await manager.whenReady()

    const outside = path.join(homeDir, 'external.txt')
    await expect(manager.ensurePathAccess(outside, 'read')).resolves.toBeUndefined()
    expect(prompt).toHaveBeenCalledOnce()

    const saved = await readFile(path.join(homeDir, '.oncecode', 'permissions.json'), 'utf8')
    expect(saved).toContain(path.dirname(outside))
  })

  it('prompts for dangerous commands and respects denial', async () => {
    const permissionsModule = await loadPermissionsModule()
    const prompt = vi.fn(async () => ({ decision: 'deny_once' as const }))
    const manager = new permissionsModule.PermissionManager(workspaceDir, prompt)
    await manager.whenReady()

    await expect(
      manager.ensureCommand('git', ['push', '--force'], workspaceDir),
    ).rejects.toThrow('Command denied')
  })

  it('supports edit approval with feedback rejection', async () => {
    const permissionsModule = await loadPermissionsModule()
    const prompt = vi.fn(async () => ({
      decision: 'deny_with_feedback' as const,
      feedback: 'Use a smaller diff',
    }))
    const manager = new permissionsModule.PermissionManager(workspaceDir, prompt)
    await manager.whenReady()

    await expect(
      manager.ensureEdit(path.join(workspaceDir, 'a.ts'), '--- a\n+++ b'),
    ).rejects.toThrow('User guidance: Use a smaller diff')
  })

  it('returns the permission store path', async () => {
    const permissionsModule = await loadPermissionsModule()
    expect(permissionsModule.getPermissionsPath()).toContain('.oncecode/permissions.json')
  })
})
