import process from 'node:process'
import { t } from '../i18n/index.js'
import { renderMarkdownish } from './markdown.js'
import type { TranscriptEntry } from './types.js'
import {
  DEFAULT_TERMINAL_ROWS,
  TOOL_PREVIEW_MAX_CHARS_DEFAULT,
  TOOL_PREVIEW_MAX_CHARS_READ,
  TOOL_PREVIEW_MAX_LINES_DEFAULT,
  TOOL_PREVIEW_MAX_LINES_READ,
} from './constants.js'

const RESET = '\u001b[0m'
const DIM = '\u001b[2m'
const CYAN = '\u001b[36m'
const GREEN = '\u001b[32m'
const YELLOW = '\u001b[33m'
const RED = '\u001b[31m'
const MAGENTA = '\u001b[35m'
const BOLD = '\u001b[1m'
const BLUE = '\u001b[34m'

function indentBlock(input: string, prefix = '  '): string {
  return input
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n')
}

function previewToolBody(toolName: string, body: string): string {
  const maxChars = toolName === 'read_file' ? TOOL_PREVIEW_MAX_CHARS_READ : TOOL_PREVIEW_MAX_CHARS_DEFAULT
  const maxLines = toolName === 'read_file' ? TOOL_PREVIEW_MAX_LINES_READ : TOOL_PREVIEW_MAX_LINES_DEFAULT
  const lines = body.split('\n')
  const limitedLines = lines.length > maxLines ? lines.slice(0, maxLines) : lines
  let limited = limitedLines.join('\n')

  if (limited.length > maxChars) {
    limited = `${limited.slice(0, maxChars)}...`
  }

  if (limited !== body) {
    return `${limited}\n${DIM}${t('transcript_truncated')}${RESET}`
  }

  return limited
}

function renderTranscriptEntry(entry: TranscriptEntry): string {
  if (entry.kind === 'user') {
    return `${CYAN}${BOLD}${t('transcript_role_user')}${RESET}\n${indentBlock(entry.body)}`
  }

  if (entry.kind === 'assistant') {
    return `${GREEN}${BOLD}${t('transcript_role_assistant')}${RESET}\n${indentBlock(
      renderMarkdownish(entry.body),
    )}`
  }

  if (entry.kind === 'progress') {
    return `${YELLOW}${BOLD}${t('transcript_role_progress')}${RESET}\n${indentBlock(
      renderMarkdownish(entry.body),
    )}`
  }

  const status =
    entry.status === 'running'
      ? `${YELLOW}${t('transcript_status_running')}${RESET}`
      : entry.status === 'success'
        ? `${GREEN}${t('transcript_status_ok')}${RESET}`
        : `${RED}${t('transcript_status_error')}${RESET}`

  const body =
    entry.status === 'running'
      ? entry.body
      : entry.collapsed
        ? `${DIM}${entry.collapsedSummary ?? t('transcript_collapsed')}${RESET}`
        : entry.collapsePhase
          ? `${DIM}${t('transcript_collapsing')}${'.'.repeat(entry.collapsePhase)}${RESET}`
          : previewToolBody(entry.toolName, renderMarkdownish(entry.body))

  return `${MAGENTA}${BOLD}${t('transcript_tool_label')}${RESET} ${entry.toolName} ${status}\n${indentBlock(body)}`
}

export function getTranscriptWindowSize(windowSize?: number): number {
  if (windowSize !== undefined) {
    return Math.max(4, windowSize)
  }
  const rows = process.stdout.rows ?? DEFAULT_TERMINAL_ROWS
  return Math.max(8, rows - 15)
}

function renderTranscriptLines(entries: TranscriptEntry[]): string[] {
  const rendered = entries.map(renderTranscriptEntry)
  const separator = `${BLUE}${DIM}·${RESET}`
  const lines: string[] = []

  rendered.forEach((block, index) => {
    if (index > 0) {
      lines.push('')
      lines.push(separator)
      lines.push('')
    }

    lines.push(...block.split('\n'))
  })

  return lines
}

export function getTranscriptMaxScrollOffset(
  entries: TranscriptEntry[],
  windowSize?: number,
): number {
  if (entries.length === 0) return 0
  const lines = renderTranscriptLines(entries)
  return Math.max(0, lines.length - getTranscriptWindowSize(windowSize))
}

export function renderTranscript(
  entries: TranscriptEntry[],
  scrollOffset: number,
  windowSize?: number,
): string {
  if (entries.length === 0) {
    return ''
  }

  const lines = renderTranscriptLines(entries)
  const pageSize = getTranscriptWindowSize(windowSize)
  const maxOffset = Math.max(0, lines.length - pageSize)
  const offset = Math.max(0, Math.min(scrollOffset, maxOffset))
  const end = lines.length - offset
  const start = Math.max(0, end - pageSize)
  const body = lines.slice(start, end).join('\n')

  if (offset === 0) {
    return body
  }

  return `${body}\n\n${DIM}${t('transcript_scroll_offset', { offset: String(offset) })}${RESET}`
}
