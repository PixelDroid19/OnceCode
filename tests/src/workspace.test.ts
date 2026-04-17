import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveToolPath } from '../../src/workspace.js'

describe('workspace.resolveToolPath', () => {
  it('resolves workspace-local paths without permissions', async () => {
    const cwd = '/tmp/project'
    await expect(
      resolveToolPath({ cwd }, 'src/index.ts', 'read'),
    ).resolves.toBe(path.join(cwd, 'src/index.ts'))
  })

  it('rejects escaping paths when permissions are absent', async () => {
    await expect(
      resolveToolPath({ cwd: '/tmp/project' }, '../secret.txt', 'read'),
    ).rejects.toThrow('Path escapes workspace')
  })

  it('delegates to permission manager when present', async () => {
    const ensurePathAccess = vi.fn(async () => {})
    const cwd = '/tmp/project'
    const target = path.join(cwd, 'src/index.ts')
    await expect(
      resolveToolPath(
        {
          cwd,
          permissions: {
            ensurePathAccess,
          } as never,
        },
        'src/index.ts',
        'read',
      ),
    ).resolves.toBe(target)
    expect(ensurePathAccess).toHaveBeenCalledWith(target, 'read')
  })
})
