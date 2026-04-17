import { afterEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeTempDir } from './helpers/fs.js'
import { setEnv } from './helpers/env.js'
import { importFresh } from './helpers/module.js'

describe('history', () => {
  let homeDir = ''

  afterEach(async () => {
    if (homeDir) {
      await removeTempDir(homeDir)
      homeDir = ''
    }
  })

  it('loads empty history when file is missing', async () => {
    homeDir = await makeTempDir('oncecode-home')
    setEnv({ HOME: homeDir })
    const history = await importFresh<typeof import('../../src/history.js')>(
      '../../src/history.js',
    )

    await expect(history.loadHistoryEntries()).resolves.toEqual([])
  })

  it('persists only the latest 200 history entries', async () => {
    homeDir = await makeTempDir('oncecode-home')
    setEnv({ HOME: homeDir })
    const history = await importFresh<typeof import('../../src/history.js')>(
      '../../src/history.js',
    )

    const entries = Array.from({ length: 220 }, (_, index) => `entry-${index}`)
    await history.saveHistoryEntries(entries)

    const loaded = await history.loadHistoryEntries()
    expect(loaded).toHaveLength(200)
    expect(loaded[0]).toBe('entry-20')
    expect(loaded.at(-1)).toBe('entry-219')
  })
})
