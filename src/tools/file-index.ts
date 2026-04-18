import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_LIST_FILES_RESULTS } from '@/constants.js'

type IndexedEntry = {
  relativePath: string
  kind: 'file' | 'dir'
  modifiedMs: number
}

type FileIndex = {
  root: string
  entries: IndexedEntry[]
  builtAt: number
}

const INDEX_TTL_MS = 5_000
const MAX_INDEXED_ENTRIES = 20_000
const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.idea',
  '.vscode',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
])

const indexCache = new Map<string, FileIndex>()

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/')
}

function scoreEntry(relativePath: string, query: string): number {
  const normalizedPath = relativePath.toLowerCase()
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return 0
  }

  const fileName = path.basename(normalizedPath)
  let score = 0

  if (fileName === normalizedQuery) score += 400
  if (normalizedPath === normalizedQuery) score += 300
  if (fileName.startsWith(normalizedQuery)) score += 180
  if (normalizedPath.startsWith(normalizedQuery)) score += 120
  if (fileName.includes(normalizedQuery)) score += 80
  if (normalizedPath.includes(normalizedQuery)) score += 40

  let position = -1
  let fuzzyScore = 0
  for (const char of normalizedQuery) {
    position = normalizedPath.indexOf(char, position + 1)
    if (position === -1) {
      return -1
    }
    fuzzyScore += Math.max(1, 8 - Math.min(position, 7))
  }

  return score + fuzzyScore - Math.min(60, normalizedPath.length)
}

async function walkDirectory(
  root: string,
  relativeDir: string,
  output: IndexedEntry[],
): Promise<void> {
  if (output.length >= MAX_INDEXED_ENTRIES) {
    return
  }

  const absoluteDir = relativeDir ? path.join(root, relativeDir) : root
  const entries = await readdir(absoluteDir, { withFileTypes: true })

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) {
      continue
    }

    const relativePath = normalizeRelativePath(
      relativeDir ? path.join(relativeDir, entry.name) : entry.name,
    )
    const absolutePath = path.join(root, relativePath)
    const stats = await stat(absolutePath)

    output.push({
      relativePath,
      kind: entry.isDirectory() ? 'dir' : 'file',
      modifiedMs: stats.mtimeMs,
    })

    if (output.length >= MAX_INDEXED_ENTRIES) {
      return
    }

    if (entry.isDirectory()) {
      await walkDirectory(root, relativePath, output)
      if (output.length >= MAX_INDEXED_ENTRIES) {
        return
      }
    }
  }
}

async function buildFileIndex(root: string): Promise<FileIndex> {
  const entries: IndexedEntry[] = []
  await walkDirectory(root, '', entries)
  return {
    root,
    entries,
    builtAt: Date.now(),
  }
}

export async function getFileIndex(root: string): Promise<FileIndex> {
  const cached = indexCache.get(root)
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) {
    return cached
  }

  const fresh = await buildFileIndex(root)
  indexCache.set(root, fresh)
  return fresh
}

export async function searchIndexedFiles(args: {
  root: string
  query?: string
  relativeBase?: string
}): Promise<IndexedEntry[]> {
  const index = await getFileIndex(args.root)
  const normalizedBase = args.relativeBase
    ? normalizeRelativePath(args.relativeBase).replace(/\/+$/, '')
    : ''

  let entries = index.entries.filter(entry =>
    normalizedBase
      ? entry.relativePath === normalizedBase || entry.relativePath.startsWith(`${normalizedBase}/`)
      : true,
  )

  if (!args.query?.trim()) {
    return entries
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .slice(0, MAX_LIST_FILES_RESULTS)
  }

  entries = entries
    .map(entry => ({ entry, score: scoreEntry(entry.relativePath, args.query!) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      if (b.entry.modifiedMs !== a.entry.modifiedMs) {
        return b.entry.modifiedMs - a.entry.modifiedMs
      }
      return a.entry.relativePath.localeCompare(b.entry.relativePath)
    })
    .slice(0, MAX_LIST_FILES_RESULTS)
    .map(item => item.entry)

  return entries
}

export function clearFileIndexCache(): void {
  indexCache.clear()
}
