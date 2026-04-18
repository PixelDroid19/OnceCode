import type { RuntimeConfig } from '../config.js'
import type { ContextTracker } from '../context-tracker.js'
import type { ToolRegistry } from '../tool.js'
import type { ChatMessage, ModelAdapter } from '../types.js'
import type { PermissionManager, PermissionPromptResult, PermissionRequest } from '../permissions.js'
import type { TranscriptEntry } from '../tui/types.js'

/** Arguments needed to bootstrap the TTY-based interactive session. */
export type TtyAppArgs = {
  runtime: RuntimeConfig | null
  tools: ToolRegistry
  model: ModelAdapter
  messages: ChatMessage[]
  cwd: string
  permissions: PermissionManager
  contextTracker: ContextTracker
}

/** State for a permission prompt currently awaiting user input. */
export type PendingApproval = {
  request: PermissionRequest
  resolve: (result: PermissionPromptResult) => void
  detailsExpanded: boolean
  detailsScrollOffset: number
  selectedChoiceIndex: number
  feedbackMode: boolean
  feedbackInput: string
}

/** Mutable state driving the TTY screen rendering loop. */
export type ScreenState = {
  input: string
  cursorOffset: number
  transcript: TranscriptEntry[]
  transcriptScrollOffset: number
  selectedSlashIndex: number
  status: string | null
  activeTool: string | null
  recentTools: Array<{ name: string; status: 'success' | 'error' }>
  history: string[]
  historyIndex: number
  historyDraft: string
  nextEntryId: number
  pendingApproval: PendingApproval | null
  isBusy: boolean
}

/** A transcript entry without an ID, used before insertion into state. */
export type TranscriptEntryDraft =
  | Omit<Extract<TranscriptEntry, { kind: 'user' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'assistant' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'progress' }>, 'id'>
  | Omit<Extract<TranscriptEntry, { kind: 'tool' }>, 'id'>

/** Tracks progress when multiple file-edit tool calls target the same path. */
export type AggregatedEditProgress = {
  entryId: number
  toolName: string
  path: string
  total: number
  completed: number
  errors: number
  lastOutput: string
}
