import type { ScreenState, TtyAppArgs } from './types.js'
import { DEFAULT_TERMINAL_ROWS } from '../tui/constants.js'
import {
  getTranscriptMaxScrollOffset,
} from '../tui/transcript.js'
import {
  renderBanner,
  renderPanel,
  renderSlashMenu,
} from '../tui/chrome.js'
import { renderInputPrompt } from '../tui/input.js'
import {
  findMatchingSlashCommands,
  getSlashCommands,
} from '../cli-commands.js'
import type { SlashCommand } from '../cli-commands.js'
import { summarizeMcpServers } from '../mcp-status.js'

/** Filters slash commands matching the current input prefix for autocomplete display. */
export function getVisibleCommands(input: string): SlashCommand[] {
  const commands = getSlashCommands()
  if (!input.startsWith('/')) return []
  if (input === '/') return commands
  const matches = findMatchingSlashCommands(input)
  return commands.filter(command => matches.includes(command.usage))
}

/** Scrolls the transcript view by a delta, clamping to valid bounds. */
export function scrollTranscriptBy(
  args: TtyAppArgs,
  state: ScreenState,
  delta: number,
): boolean {
  const nextOffset = Math.max(
    0,
    Math.min(
      getMaxTranscriptScrollOffset(args, state),
      state.transcriptScrollOffset + delta,
    ),
  )

  if (nextOffset === state.transcriptScrollOffset) {
    return false
  }

  state.transcriptScrollOffset = nextOffset
  return true
}

/** Jumps the transcript scroll position to the top or bottom edge. */
export function jumpTranscriptToEdge(
  args: TtyAppArgs,
  state: ScreenState,
  target: 'top' | 'bottom',
): boolean {
  const nextOffset =
    target === 'top' ? getMaxTranscriptScrollOffset(args, state) : 0
  if (nextOffset === state.transcriptScrollOffset) {
    return false
  }

  state.transcriptScrollOffset = nextOffset
  return true
}

/** Navigates to the previous entry in command history. */
export function historyUp(state: ScreenState): boolean {
  if (state.history.length === 0 || state.historyIndex <= 0) {
    return false
  }

  if (state.historyIndex === state.history.length) {
    state.historyDraft = state.input
  }

  state.historyIndex -= 1
  state.input = state.history[state.historyIndex] ?? ''
  state.cursorOffset = state.input.length
  return true
}

/** Navigates to the next entry in command history. */
export function historyDown(state: ScreenState): boolean {
  if (state.historyIndex >= state.history.length) {
    return false
  }

  state.historyIndex += 1
  state.input =
    state.historyIndex === state.history.length
      ? state.historyDraft
      : (state.history[state.historyIndex] ?? '')
  state.cursorOffset = state.input.length
  return true
}

/** Calculates available lines for transcript content based on terminal size. */
export function getTranscriptBodyLines(args: TtyAppArgs, state: ScreenState): number {
  const rows = Math.max(24, process.stdout.rows ?? DEFAULT_TERMINAL_ROWS)
  const headerLines = renderHeaderPanel(args, state).split('\n').length
  const promptLines = renderPromptPanel(state).split('\n').length
  const footerLines = 1
  const gapsBetweenSections = 3
  const transcriptPanelFrameLines = 4
  const remaining =
    rows -
    headerLines -
    promptLines -
    footerLines -
    gapsBetweenSections -
    transcriptPanelFrameLines

  return Math.max(6, remaining)
}

function getMaxTranscriptScrollOffset(args: TtyAppArgs, state: ScreenState): number {
  return getTranscriptMaxScrollOffset(
    state.transcript,
    getTranscriptBodyLines(args, state),
  )
}

function getSessionStats(args: TtyAppArgs, state: ScreenState) {
  const mcpStatus = summarizeMcpServers(args.tools.getMcpServers())
  return {
    transcriptCount: state.transcript.length,
    messageCount: args.messages.length,
    skillCount: args.tools.getSkills().length,
    mcpTotalCount: mcpStatus.total,
    mcpConnectedCount: mcpStatus.connected,
    mcpConnectingCount: mcpStatus.connecting,
    mcpErrorCount: mcpStatus.error,
    contextUsagePercent: args.contextTracker.usagePercent,
    contextWarningLevel: args.contextTracker.warningLevel,
  }
}

/** Renders the top banner panel with project info and session stats. */
export function renderHeaderPanel(args: TtyAppArgs, state: ScreenState): string {
  return renderBanner(
    args.runtime,
    args.cwd,
    args.permissions.getSummary(),
    getSessionStats(args, state),
  )
}

/** Renders the input prompt panel with optional slash command menu. */
export function renderPromptPanel(state: ScreenState): string {
  const commands = getVisibleCommands(state.input)
  const promptBody = [
    renderInputPrompt(state.input, state.cursorOffset),
    commands.length > 0
      ? `\n${renderSlashMenu(
          commands,
          Math.min(state.selectedSlashIndex, commands.length - 1),
        )}`
      : '',
  ].join('')
  return renderPanel('prompt', promptBody)
}
