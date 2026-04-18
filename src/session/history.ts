import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { MAX_HISTORY_ENTRIES } from '@/constants.js'
import { ONCECODE_DIR, ONCECODE_HISTORY_PATH } from '@/config/store.js'

type HistoryFile = {
  entries: string[]
}

export async function loadHistoryEntries(): Promise<string[]> {
  try {
    const raw = await readFile(ONCECODE_HISTORY_PATH, 'utf8')
    const parsed = JSON.parse(raw) as HistoryFile
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

export async function saveHistoryEntries(entries: string[]): Promise<void> {
  await mkdir(ONCECODE_DIR, { recursive: true })
  await writeFile(
    ONCECODE_HISTORY_PATH,
    `${JSON.stringify({ entries: entries.slice(-MAX_HISTORY_ENTRIES) }, null, 2)}\n`,
    'utf8',
  )
}
