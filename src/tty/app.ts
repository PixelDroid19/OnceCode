import process from 'node:process'
import { listBackgroundTasks } from '@/workspace/background-tasks.js'
import { runAgentTurn } from '@/agent/loop.js'
import {
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from '@/commands/handlers.js'
import { compactConversation } from '@/context/compaction.js'
import { loadRuntimeConfig } from '@/config/runtime.js'
import {
  readProviderState,
  saveProviderConnection,
} from '@/config/provider-store.js'
import {
  formatModelRef,
  getProviderInfo,
  listModels,
  listProviders,
} from '@/provider/catalog.js'
import { loadHistoryEntries, saveHistoryEntries } from '@/session/history.js'
import { parseLocalToolShortcut } from '@/commands/shortcuts.js'
import { summarizeMcpServers } from '@/mcp/status.js'
import {
  PermissionManager,
} from '@/permissions/manager.js'
import { refreshSystemPrompt } from '@/session/system-prompt.js'
import { parseInputChunk, type ParsedInputEvent } from '@/tui/input-parser.js'
import { t } from '@/i18n/index.js'
import {
  clearScreen,
  enterAlternateScreen,
  exitAlternateScreen,
  hideCursor,
  renderFooterBar,
  renderPanel,
  renderPermissionPrompt,
  renderStatusLine,
  renderToolPanel,
  renderTranscript,
  showCursor,
} from '@/tui/index.js'

import type {
  TtyAppArgs,
  ScreenState,
  AggregatedEditProgress,
  ConnectDialog,
} from './types.js'
import {
  pushTranscriptEntry,
  updateTranscriptEntry,
  updateToolEntry,
  collapseToolEntry,
  getRunningToolEntries,
  finalizeDanglingRunningTools,
  summarizeCollapsedToolBody,
  summarizeToolInput,
  isFileEditTool,
  extractPathFromToolInput,
} from './transcript-helpers.js'
import {
  getVisibleCommands,
  scrollTranscriptBy,
  jumpTranscriptToEdge,
  historyUp,
  historyDown,
  getTranscriptBodyLines,
  renderHeaderPanel,
  renderPromptPanel,
} from './state.js'
import {
  scrollPendingApprovalBy,
  togglePendingApprovalExpand,
  movePendingApprovalSelection,
  createPermissionPromptHandler,
} from './approval-controller.js'
import { withScope } from '@/utils/scope.js'

export type { TtyAppArgs }

function visible(dialog: ConnectDialog): string[] {
  if (!dialog.query.trim()) return dialog.ids

  const query = dialog.query.trim().toLowerCase()
  const ids = dialog.step === 'model'
    ? listModels(dialog.pid ?? undefined).map(item => item.ref)
    : dialog.ids

  return ids.filter(id => id.toLowerCase().includes(query))
}

function pick(dialog: ConnectDialog): string | null {
  const ids = visible(dialog)
  if (ids.length === 0) return null
  return ids[Math.min(dialog.idx, ids.length - 1)] ?? null
}

async function openConnectDialog(
  args: TtyAppArgs,
  state: ScreenState,
): Promise<void> {
  const saved = await readProviderState()
  const ids = listProviders().map(item => item.id)
  state.providerDialog = {
    step: 'provider',
    ids,
    map: saved.providers ?? {},
    idx: 0,
    pid: null,
    auth: 0,
    token: '',
    base: '',
    query: '',
    active: args.runtime?.provider.id ?? saved.activeProvider ?? null,
    note: null,
  }
  state.status = t('ui_connecting_provider')
}

function renderConnectDialog(dialog: ConnectDialog): string {
  if (dialog.step === 'token') {
    return [
      'Enter API key or token.',
      '',
      `provider: ${dialog.pid}`,
      `token: ${dialog.token ? '*'.repeat(Math.min(dialog.token.length, 24)) : ''}`,
      '',
      'Enter save | Esc cancel',
    ].join('\n')
  }

  if (dialog.step === 'base') {
    return [
      'Enter base URL or leave blank for default.',
      '',
      `provider: ${dialog.pid}`,
      `baseUrl: ${dialog.base}`,
      '',
      'Enter continue | Esc cancel',
    ].join('\n')
  }

  const ids = visible(dialog)
  const rows = ids.slice(Math.max(0, dialog.idx - 8), Math.max(0, dialog.idx - 8) + 16)

  return [
    dialog.step === 'provider'
      ? 'Select a provider to connect.'
      : dialog.step === 'auth'
        ? 'Select an auth method.'
        : 'Select a model for this provider.',
    dialog.note ?? '',
    dialog.query ? `filter: ${dialog.query}` : '',
    '',
    ...rows.map(id => {
      const selected = id === pick(dialog)
      const label = dialog.step === 'model'
        ? `${id}${id === dialog.active ? ' *' : ''}`
        : `${id}${dialog.map[id] ? ' [saved]' : ''}${id === dialog.active ? ' *' : ''}`
      return `${selected ? '>' : ' '} ${label}`
    }),
    '',
    'Up/Down move | Type filter | Enter select | Esc cancel',
  ].filter(Boolean).join('\n')
}

async function submitConnectDialog(
  args: TtyAppArgs,
  state: ScreenState,
): Promise<void> {
  const dialog = state.providerDialog
  if (!dialog) return

  if (dialog.step === 'provider') {
    const id = pick(dialog)
    if (!id) return
    const provider = getProviderInfo(id)
    if (!provider) return
    dialog.pid = id
    dialog.idx = 0
    dialog.query = ''
    dialog.auth = 0
    dialog.base = dialog.map[id]?.baseUrl ?? provider.defaultBaseUrl
    dialog.token = ''
    dialog.step = provider.auth.length > 1 ? 'auth' : 'token'
    return
  }

  if (dialog.step === 'auth') {
    dialog.auth = Math.min(dialog.idx, (getProviderInfo(dialog.pid ?? '')?.auth.length ?? 1) - 1)
    dialog.idx = 0
    dialog.query = ''
    dialog.step = 'token'
    return
  }

  if (dialog.step === 'token') {
    dialog.step = 'base'
    return
  }

  if (dialog.step === 'base') {
    dialog.ids = listModels(dialog.pid ?? undefined).map(item => item.ref)
    dialog.idx = 0
    dialog.query = ''
    dialog.step = 'model'
    return
  }

  const ref = pick(dialog)
  const provider = getProviderInfo(dialog.pid ?? '')
  if (!ref || !provider) return
  const auth = provider.auth[Math.min(dialog.auth, provider.auth.length - 1)]
  const token = dialog.token.trim() || dialog.map[provider.id]?.vars?.[auth?.env ?? ''] || ''
  if (!auth || !token) {
    dialog.note = t('install_token_empty', { env: auth?.env ?? 'API_KEY' })
    dialog.step = 'token'
    return
  }

  await saveProviderConnection({
    providerId: provider.id,
    vars: { [auth.env]: token },
    baseUrl: dialog.base.trim() || provider.defaultBaseUrl,
    model: ref,
  })
  const next = await loadRuntimeConfig()
  args.runtime = next
  args.contextTracker.setModel(next.model, next.maxOutputTokens)
  state.providerDialog = null
  state.status = null
  pushTranscriptEntry(state, {
    kind: 'assistant',
    body: `${provider.name} connected\n${formatModelRef(next.model)}`,
  })
}

function moveConnectDialog(state: ScreenState, delta: number): boolean {
  const dialog = state.providerDialog
  if (!dialog || dialog.step === 'token' || dialog.step === 'base') return false
  const ids = visible(dialog)
  if (ids.length === 0) return false
  const next = Math.max(0, Math.min(ids.length - 1, dialog.idx + delta))
  if (next === dialog.idx) return false
  dialog.idx = next
  return true
}

function renderScreen(args: TtyAppArgs, state: ScreenState): void {
  const backgroundTasks = listBackgroundTasks()
  clearScreen()
  console.log(renderHeaderPanel(args, state))
  console.log('')

  if (state.pendingApproval) {
    console.log(
      renderPanel(t('ui_panel_approval'), renderPermissionPrompt(state.pendingApproval.request, {
        expanded: state.pendingApproval.detailsExpanded,
        scrollOffset: state.pendingApproval.detailsScrollOffset,
        selectedChoiceIndex: state.pendingApproval.selectedChoiceIndex,
        feedbackMode: state.pendingApproval.feedbackMode,
        feedbackInput: state.pendingApproval.feedbackInput,
      })),
    )
    console.log('')
    console.log(renderPanel(t('ui_panel_activity'), renderToolPanel(state.activeTool, state.recentTools, backgroundTasks)))
    console.log('')
    console.log(
      renderFooterBar(
        state.status,
        true,
        args.tools.getSkills().length > 0,
        summarizeMcpServers(args.tools.getMcpServers()),
        backgroundTasks,
      ),
    )
    return
  }

  if (state.providerDialog) {
    console.log(renderPanel(t('ui_panel_connect'), renderConnectDialog(state.providerDialog)))
    console.log('')
    console.log(renderPanel(t('ui_panel_activity'), renderToolPanel(state.activeTool, state.recentTools, backgroundTasks)))
    console.log('')
    console.log(
      renderFooterBar(
        state.status,
        true,
        args.tools.getSkills().length > 0,
        summarizeMcpServers(args.tools.getMcpServers()),
        backgroundTasks,
      ),
    )
    return
  }

  console.log(
    renderPanel(
      t('ui_panel_session'),
      state.transcript.length > 0
        ? renderTranscript(
            state.transcript,
            state.transcriptScrollOffset,
            getTranscriptBodyLines(args, state),
          )
        : `${renderStatusLine(null)}\n\n${t('ui_hint_help')}`,
      {
        rightTitle: `${state.transcript.length} events`,
        minBodyLines: getTranscriptBodyLines(args, state),
      },
    ),
  )
  console.log('')
  console.log(renderPromptPanel(state))

  console.log('')
  console.log(
    renderFooterBar(
      state.status,
      true,
      args.tools.getSkills().length > 0,
      summarizeMcpServers(args.tools.getMcpServers()),
      backgroundTasks,
    ),
  )
}

async function executeToolShortcut(
  args: TtyAppArgs,
  state: ScreenState,
  toolName: string,
  input: unknown,
  rerender: () => void,
): Promise<void> {
  state.isBusy = true
  state.status = t('ui_running_tool', { toolName })
  state.activeTool = toolName
  const entryId = pushTranscriptEntry(state, {
    kind: 'tool',
    toolName,
    status: 'running',
    body: summarizeToolInput(toolName, input),
  })
  rerender()

  try {
    const result = await args.tools.execute(toolName, input, {
      cwd: args.cwd,
      permissions: args.permissions,
    })

    state.recentTools.push({
      name: toolName,
      status: result.ok ? 'success' : 'error',
    })
    updateToolEntry(
      state,
      entryId,
      result.ok ? 'success' : 'error',
      result.ok ? result.output : `ERROR: ${result.output}`,
    )
    collapseToolEntry(
      state,
      entryId,
      summarizeCollapsedToolBody(
        result.ok ? result.output : `ERROR: ${result.output}`,
      ),
    )
    state.transcriptScrollOffset = 0
  } finally {
    state.isBusy = false
    state.activeTool = null
    finalizeDanglingRunningTools(state)
    if (getRunningToolEntries(state).length === 0) {
      state.status = null
    }
  }
}

async function handleInput(
  args: TtyAppArgs,
  state: ScreenState,
  rerender: () => void,
  submittedRawInput?: string,
): Promise<boolean> {
  if (state.isBusy) {
    state.status = state.activeTool
      ? t('ui_running_tool', { toolName: state.activeTool })
      : t('ui_turn_running')
    return false
  }

  const input = (submittedRawInput ?? state.input).trim()
  if (!input) return false
  if (input === '/exit') return true

  if (state.history.at(-1) !== input) {
    state.history.push(input)
    await saveHistoryEntries(state.history)
  }
  state.historyIndex = state.history.length
  state.historyDraft = ''

  if (input === '/tools') {
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: args.tools
        .list()
        .map(tool => `${tool.name}: ${tool.description}`)
        .join('\n'),
    })
    return false
  }

  if (input === '/connect') {
    await openConnectDialog(args, state)
    return false
  }

  // Manual compaction via /compact
  if (input === '/compact') {
    state.isBusy = true
    state.status = t('context_compacting')
    rerender()
    try {
      const result = await compactConversation({
        model: args.model,
        messages: args.messages,
        onProgress(status) {
          state.status = status
          rerender()
        },
      })
      if (result) {
        args.messages.length = 0
        args.messages.push(...result.messages)
        args.contextTracker.resetAfterCompaction(result.postCompactTokens)
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: t('context_compacted', {
            before: String(result.beforeCount),
            after: String(result.afterCount),
          }),
        })
      } else {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: t('context_compact_failed'),
        })
      }
    } finally {
      state.isBusy = false
      state.status = null
    }
    return false
  }

  const localCommandResult = await tryHandleLocalCommand(input, {
    tools: args.tools,
    contextTracker: args.contextTracker,
    runtime: args.runtime,
    async onRuntimeChange(next) {
      args.runtime = next
      args.contextTracker.setModel(next.model, next.maxOutputTokens)
    },
  })
  if (localCommandResult !== null) {
    pushTranscriptEntry(state, {
      kind: 'assistant',
      body: localCommandResult,
    })
    return false
  }

  const toolShortcut = parseLocalToolShortcut(input)
  if (toolShortcut) {
    await executeToolShortcut(
      args,
      state,
      toolShortcut.toolName,
      toolShortcut.input,
      rerender,
    )
    return false
  }

  if (input.startsWith('/')) {
    const matches = findMatchingSlashCommands(input)
    pushTranscriptEntry(state, {
      kind: 'assistant',
        body:
          matches.length > 0
            ? t('cmd_unknown_suggest', {
                matches: matches.join('\n'),
              })
            : t('cmd_unknown'),
    })
    return false
  }

  await refreshSystemPrompt(args)
  const messagesBeforeUserInput = [...args.messages]
  args.messages.push({ role: 'user', content: input })
  pushTranscriptEntry(state, {
    kind: 'user',
    body: input,
  })
  state.transcriptScrollOffset = 0
  state.status = t('ui_thinking')
  state.isBusy = true
  rerender()

  // ── Auto-compaction check before sending to model ───────────────
  if (
    args.contextTracker.shouldCompactNextTurn(args.messages, messagesBeforeUserInput) &&
    args.contextTracker.canAutoCompact()
  ) {
    state.status = t('context_auto_compacting')
    rerender()
    try {
      const result = await compactConversation({
        model: args.model,
        messages: args.messages,
        onProgress(status) {
          state.status = status
          rerender()
        },
      })
      if (result) {
        args.messages.length = 0
        args.messages.push(...result.messages)
        args.contextTracker.resetAfterCompaction(result.postCompactTokens)
        pushTranscriptEntry(state, {
          kind: 'progress',
          body: t('context_auto_compacted'),
        })
        // Synthetic continue message so the model knows to proceed
        args.messages.push({
          role: 'user',
          content: 'Continue if you have next steps, or stop and ask for clarification.',
        })
      } else {
        args.contextTracker.recordCompactFailure()
      }
    } catch {
      // Auto-compaction failure is non-fatal; record for circuit breaker
      args.contextTracker.recordCompactFailure()
    }
    state.status = t('ui_thinking')
    rerender()
  }

  const pendingToolEntries = new Map<string, number[]>()
  const aggregatedEditByKey = new Map<string, AggregatedEditProgress>()
  const aggregatedEditByEntryId = new Map<number, AggregatedEditProgress>()
  const turnController = new AbortController()
  state.turnController = turnController
  state.streamingAssistantEntryId = null

  args.permissions.beginTurn()
  try {
    const nextMessages = await runAgentTurn({
      model: args.model,
      tools: args.tools,
      messages: args.messages,
      cwd: args.cwd,
      permissions: args.permissions,
      signal: turnController.signal,
      onTextDelta(text) {
        const entryId = state.streamingAssistantEntryId ?? pushTranscriptEntry(state, {
          kind: 'assistant',
          body: '',
        })
        state.streamingAssistantEntryId = entryId
        const existing = state.transcript.find(entry => entry.id === entryId)
        const body = existing && (existing.kind === 'assistant' || existing.kind === 'progress' || existing.kind === 'user')
          ? `${existing.body}${text}`
          : text
        updateTranscriptEntry(state, entryId, body)
        state.transcriptScrollOffset = 0
        rerender()
      },
      onUsageUpdate(usage) {
        args.contextTracker.recordUsage(usage)
        rerender()
      },
      onAssistantMessage(content) {
        if (state.streamingAssistantEntryId !== null) {
          updateTranscriptEntry(state, state.streamingAssistantEntryId, content)
          state.streamingAssistantEntryId = null
          state.transcriptScrollOffset = 0
          rerender()
          return
        }
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: content,
        })
        state.transcriptScrollOffset = 0
        rerender()
      },
      onProgressMessage(content) {
        if (state.streamingAssistantEntryId !== null) {
          state.streamingAssistantEntryId = null
        }
        pushTranscriptEntry(state, {
          kind: 'progress',
          body: content,
        })
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolStart(toolName, toolInput) {
        state.status = t('ui_running_tool', { toolName })
        state.activeTool = toolName
        let entryId: number
        const targetPath = extractPathFromToolInput(toolInput)
        const canAggregate = isFileEditTool(toolName) && targetPath !== null

        if (canAggregate) {
          const key = `${toolName}:${targetPath}`
          const existing = aggregatedEditByKey.get(key)
          if (existing) {
            existing.total += 1
            existing.lastOutput = summarizeToolInput(toolName, toolInput)
            entryId = existing.entryId
            updateToolEntry(
              state,
              entryId,
              existing.errors > 0 ? 'error' : 'running',
              `Aggregated ${toolName} for ${targetPath}\nCompleted: ${existing.completed}/${existing.total}`,
            )
          } else {
            entryId = pushTranscriptEntry(state, {
              kind: 'tool',
              toolName,
              status: 'running',
              body: summarizeToolInput(toolName, toolInput),
            })
            const progress: AggregatedEditProgress = {
              entryId,
              toolName,
              path: targetPath,
              total: 1,
              completed: 0,
              errors: 0,
              lastOutput: summarizeToolInput(toolName, toolInput),
            }
            aggregatedEditByKey.set(key, progress)
            aggregatedEditByEntryId.set(entryId, progress)
          }
        } else {
          entryId = pushTranscriptEntry(state, {
            kind: 'tool',
            toolName,
            status: 'running',
            body: summarizeToolInput(toolName, toolInput),
          })
        }
        const pending = pendingToolEntries.get(toolName) ?? []
        pending.push(entryId)
        pendingToolEntries.set(toolName, pending)
        state.transcriptScrollOffset = 0
        rerender()
      },
      onToolResult(toolName, output, isError) {
        const pending = pendingToolEntries.get(toolName) ?? []
        const entryId = pending.shift()
        pendingToolEntries.set(toolName, pending)
        if (entryId !== undefined) {
          const aggregated = aggregatedEditByEntryId.get(entryId)
          if (aggregated && aggregated.toolName === toolName) {
            aggregated.completed += 1
            if (isError) {
              aggregated.errors += 1
            }
            aggregated.lastOutput = output
            const done = aggregated.completed >= aggregated.total
            if (done) {
              state.recentTools.push({
                name: `${toolName} x${aggregated.total}`,
                status: aggregated.errors > 0 ? 'error' : 'success',
              })
            }
            const aggregatedBody = done
              ? [
                  `Aggregated ${toolName} for ${aggregated.path}`,
                  `Operations: ${aggregated.total}, errors: ${aggregated.errors}`,
                  `Last result: ${aggregated.lastOutput}`,
                ].join('\n')
              : `Aggregated ${toolName} for ${aggregated.path}\nCompleted: ${aggregated.completed}/${aggregated.total}`
            updateToolEntry(
              state,
              entryId,
              aggregated.errors > 0 ? 'error' : done ? 'success' : 'running',
              aggregatedBody,
            )
            if (done) {
              collapseToolEntry(
                state,
                entryId,
                summarizeCollapsedToolBody(aggregatedBody),
              )
              aggregatedEditByEntryId.delete(entryId)
              aggregatedEditByKey.delete(`${toolName}:${aggregated.path}`)
            }
          } else {
            state.recentTools.push({
              name: toolName,
              status: isError ? 'error' : 'success',
            })
            updateToolEntry(
              state,
              entryId,
              isError ? 'error' : 'success',
              isError ? `ERROR: ${output}` : output,
            )
            collapseToolEntry(
              state,
              entryId,
              summarizeCollapsedToolBody(
                isError ? `ERROR: ${output}` : output,
              ),
            )
          }
        } else {
          state.recentTools.push({
            name: toolName,
            status: isError ? 'error' : 'success',
          })
        }
        state.activeTool = null
        state.status = t('ui_thinking')
        rerender()
      },
    })
    args.messages.length = 0
    args.messages.push(...nextMessages)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    args.messages.push({
      role: 'assistant',
        content: t('agent_request_failed', { message }),
    })
    pushTranscriptEntry(state, {
      kind: 'assistant',
        body: t('agent_request_failed', { message }),
    })
    state.transcriptScrollOffset = 0
  } finally {
    args.permissions.endTurn()
    state.isBusy = false
    state.turnController = null
    state.streamingAssistantEntryId = null
  }

  finalizeDanglingRunningTools(state)
  if (getRunningToolEntries(state).length === 0) {
    state.status = null
  }
  return false
}

function handleApprovalEvent(
  state: ScreenState,
  event: ParsedInputEvent,
  rerender: () => void,
  finish: () => void,
): void {
  if (event.kind === 'text' && event.ctrl && event.text === 'o') {
    if (togglePendingApprovalExpand(state)) {
      rerender()
    }
    return
  }

  if (event.kind === 'text' && event.ctrl && event.text === 'c') {
    if (state.isBusy && state.turnController && !state.turnController.signal.aborted) {
      state.turnController.abort(new DOMException('User cancelled turn', 'AbortError'))
      state.status = t('agent_cancelled')
      rerender()
      return
    }
    finish()
    return
  }

  if (event.kind === 'wheel') {
    if (
      event.direction === 'up'
        ? scrollPendingApprovalBy(state, -3)
        : scrollPendingApprovalBy(state, 3)
    ) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'pageup') {
    if (scrollPendingApprovalBy(state, -8)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'pagedown') {
    if (scrollPendingApprovalBy(state, 8)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'up' && event.meta) {
    if (scrollPendingApprovalBy(state, -1)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'down' && event.meta) {
    if (scrollPendingApprovalBy(state, 1)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'up' && !event.meta) {
    if (movePendingApprovalSelection(state, -1)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'down' && !event.meta) {
    if (movePendingApprovalSelection(state, 1)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'backspace') {
    const pending = state.pendingApproval
    if (pending && pending.feedbackMode && pending.feedbackInput.length > 0) {
      pending.feedbackInput = pending.feedbackInput.slice(0, -1)
      rerender()
    }
    return
  }

  if (event.kind === 'text' && !event.ctrl && !event.meta) {
    const pending = state.pendingApproval
    if (!pending) return
    if (!pending.feedbackMode) {
      const pressed = event.text.trim().toLowerCase()
      const matched = pending.request.choices.find(
        choice => choice.key.toLowerCase() === pressed,
      )
      if (matched) {
        if (matched.decision === 'deny_with_feedback') {
          pending.feedbackMode = true
          pending.feedbackInput = ''
          rerender()
          return
        }

        state.pendingApproval = null
        state.status = null
        pending.resolve({ decision: matched.decision })
        rerender()
        return
      }
    }

    if (pending.feedbackMode) {
      pending.feedbackInput += event.text
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'return') {
    const pending = state.pendingApproval
    if (!pending) return
    if (pending.feedbackMode) {
      const feedback = pending.feedbackInput.trim()
      state.pendingApproval = null
      state.status = null
      pending.resolve({
        decision: 'deny_with_feedback',
        feedback,
      })
      rerender()
      return
    }

    const selected =
      pending.request.choices[
        Math.min(
          pending.selectedChoiceIndex,
          pending.request.choices.length - 1,
        )
      ]
    if (!selected) {
      return
    }

    if (selected.decision === 'deny_with_feedback') {
      pending.feedbackMode = true
      pending.feedbackInput = ''
      rerender()
      return
    }

    state.pendingApproval = null
    state.status = null
    pending.resolve({ decision: selected.decision })
    rerender()
    return
  }

  if (event.kind === 'key' && event.name === 'escape') {
    const pending = state.pendingApproval
    if (!pending) return
    if (pending.feedbackMode) {
      pending.feedbackMode = false
      pending.feedbackInput = ''
      rerender()
      return
    }

    state.pendingApproval = null
    state.status = null
    pending.resolve({ decision: 'deny_once' })
    rerender()
    return
  }
}

function handleNormalEvent(
  args: TtyAppArgs,
  state: ScreenState,
  event: ParsedInputEvent,
  rerender: () => void,
  finish: () => void,
  submitInput: (input: string) => void,
): void {
  if (state.providerDialog) {
    const dialog = state.providerDialog

    if (event.kind === 'text' && event.ctrl && event.text === 'c') {
      finish()
      return
    }

    if (event.kind === 'key' && event.name === 'escape') {
      state.providerDialog = null
      state.status = null
      rerender()
      return
    }

    if (event.kind === 'key' && event.name === 'up') {
      if (moveConnectDialog(state, -1)) rerender()
      return
    }

    if (event.kind === 'key' && event.name === 'down') {
      if (moveConnectDialog(state, 1)) rerender()
      return
    }

    if (event.kind === 'key' && event.name === 'backspace') {
      if (dialog.step === 'token' && dialog.token.length > 0) {
        dialog.token = dialog.token.slice(0, -1)
        rerender()
      }
      if (dialog.step === 'base' && dialog.base.length > 0) {
        dialog.base = dialog.base.slice(0, -1)
        rerender()
      }
      if ((dialog.step === 'provider' || dialog.step === 'auth' || dialog.step === 'model') && dialog.query.length > 0) {
        dialog.query = dialog.query.slice(0, -1)
        dialog.idx = 0
        rerender()
      }
      return
    }

    if (event.kind === 'key' && event.name === 'return') {
      void submitConnectDialog(args, state).then(rerender)
      return
    }

    if (event.kind === 'text' && !event.ctrl && !event.meta) {
      if (dialog.step === 'token') {
        dialog.token += event.text
        rerender()
        return
      }
      if (dialog.step === 'base') {
        dialog.base += event.text
        rerender()
        return
      }
      dialog.query += event.text
      dialog.idx = 0
      rerender()
      return
    }

    return
  }

  const visibleCommands = getVisibleCommands(state.input)

  if (event.kind === 'text' && event.ctrl && event.text === 'c') {
    finish()
    return
  }

  if (event.kind === 'wheel') {
    if (
        event.direction === 'up'
        ? scrollTranscriptBy(args, state, 3)
        : scrollTranscriptBy(args, state, -3)
    ) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'return') {
    if (state.isBusy) {
      state.status = state.activeTool
        ? t('ui_running_tool', { toolName: state.activeTool })
        : t('ui_turn_running')
      rerender()
      return
    }

    if (visibleCommands.length > 0) {
      const selected =
        visibleCommands[
          Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
        ]
      if (selected && state.input.trim() !== selected.usage) {
        state.input = selected.usage
        state.cursorOffset = state.input.length
        state.selectedSlashIndex = 0
        rerender()
        return
      }
    }

    const submittedInput = state.input
    state.input = ''
    state.cursorOffset = 0
    state.selectedSlashIndex = 0
    rerender()
    submitInput(submittedInput)
    return
  }

  if (event.kind === 'key' && event.name === 'backspace') {
    if (state.cursorOffset > 0) {
      state.input =
        state.input.slice(0, state.cursorOffset - 1) +
        state.input.slice(state.cursorOffset)
      state.cursorOffset -= 1
    }
    state.selectedSlashIndex = 0
    rerender()
    return
  }

  if (event.kind === 'key' && event.name === 'delete') {
    state.input =
      state.input.slice(0, state.cursorOffset) +
      state.input.slice(state.cursorOffset + 1)
    state.selectedSlashIndex = 0
    rerender()
    return
  }

  if (event.kind === 'key' && event.name === 'tab') {
    if (visibleCommands.length > 0) {
      const selected =
        visibleCommands[
          Math.min(state.selectedSlashIndex, visibleCommands.length - 1)
        ]
      if (selected) {
        state.input = selected.usage
        state.cursorOffset = state.input.length
        state.selectedSlashIndex = 0
        rerender()
      }
    }
    return
  }

  if (event.kind === 'text' && event.ctrl && event.text === 'p') {
    if (historyUp(state)) {
      rerender()
    }
    return
  }

  if (event.kind === 'text' && event.ctrl && event.text === 'n') {
    if (historyDown(state)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'up') {
    if (visibleCommands.length > 0) {
      state.selectedSlashIndex =
        (state.selectedSlashIndex - 1 + visibleCommands.length) %
        visibleCommands.length
      rerender()
    } else if (event.meta) {
      if (scrollTranscriptBy(args, state, 1)) {
        rerender()
      }
    } else if (historyUp(state)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'down') {
    if (visibleCommands.length > 0) {
      state.selectedSlashIndex =
        (state.selectedSlashIndex + 1) % visibleCommands.length
        rerender()
    } else if (event.meta) {
      if (scrollTranscriptBy(args, state, -1)) {
        rerender()
      }
    } else if (historyDown(state)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'pageup') {
    if (scrollTranscriptBy(args, state, 8)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'pagedown') {
    if (scrollTranscriptBy(args, state, -8)) {
      rerender()
    }
    return
  }

  if (event.kind === 'key' && event.name === 'left') {
    state.cursorOffset = Math.max(0, state.cursorOffset - 1)
    rerender()
    return
  }

  if (event.kind === 'key' && event.name === 'right') {
    state.cursorOffset = Math.min(state.input.length, state.cursorOffset + 1)
    rerender()
    return
  }

  if (event.kind === 'text' && event.ctrl && event.text === 'u') {
    state.input = ''
    state.cursorOffset = 0
    state.selectedSlashIndex = 0
    rerender()
    return
  }

  if (event.kind === 'text' && event.ctrl && event.text === 'a') {
    if (!state.input) {
      if (jumpTranscriptToEdge(args, state, 'top')) {
        rerender()
      }
      return
    }

    state.cursorOffset = 0
    rerender()
    return
  }

  if (event.kind === 'text' && event.ctrl && event.text === 'e') {
    if (!state.input) {
      if (jumpTranscriptToEdge(args, state, 'bottom')) {
        rerender()
      }
      return
    }

    state.cursorOffset = state.input.length
    rerender()
    return
  }

  if (event.kind === 'key' && event.name === 'escape') {
    state.input = ''
    state.cursorOffset = 0
    state.selectedSlashIndex = 0
    rerender()
    return
  }

  if (event.kind === 'text' && !event.ctrl) {
    state.input =
      state.input.slice(0, state.cursorOffset) +
      event.text +
      state.input.slice(state.cursorOffset)
    state.cursorOffset += event.text.length
    state.selectedSlashIndex = 0
    state.historyIndex = state.history.length
    rerender()
  }
}

export async function runTtyApp(args: TtyAppArgs): Promise<void> {
  await withScope(async scope => {
    enterAlternateScreen()
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    hideCursor()
    scope.addFinalizer(() => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      showCursor()
      exitAlternateScreen()
      process.stdin.pause()
      process.stdout.write(`${t('ui_exited')}\n`)
    })

    const state: ScreenState = {
      input: '',
      cursorOffset: 0,
      transcript: [],
      transcriptScrollOffset: 0,
      selectedSlashIndex: 0,
      status: null,
      activeTool: null,
      recentTools: [],
      history: await loadHistoryEntries(),
      historyIndex: 0,
      historyDraft: '',
      nextEntryId: 1,
      pendingApproval: null,
      providerDialog: null,
      isBusy: false,
      turnController: null,
      streamingAssistantEntryId: null,
    }
    state.historyIndex = state.history.length

    const permissionArgs: TtyAppArgs = {
      ...args,
      permissions: new PermissionManager(
        args.cwd,
        createPermissionPromptHandler(state, () => renderScreen(permissionArgs, state)),
      ),
    }
    await permissionArgs.permissions.whenReady()
    if (
      permissionArgs.messages.length === 0 ||
      permissionArgs.messages[0]?.role !== 'system'
    ) {
      await refreshSystemPrompt(permissionArgs)
    }

    renderScreen(permissionArgs, state)

    await new Promise<void>(resolve => {
      let finished = false
      let inputRemainder = ''
      let eventChain = Promise.resolve()
      let submitInFlight = false

      const cleanup = () => {
        process.stdin.off('data', onData)
        process.stdin.off('end', onEnd)
        process.stdin.off('close', onClose)
      }

      const finish = () => {
        if (finished) return
        finished = true
        cleanup()
        resolve()
      }

      const rerender = () => renderScreen(permissionArgs, state)

      const handleEvent = async (event: ParsedInputEvent) => {
      try {
        if (state.pendingApproval) {
          handleApprovalEvent(state, event, rerender, finish)
          return
        }

        handleNormalEvent(
          permissionArgs,
          state,
          event,
          rerender,
          finish,
          (submittedInput: string) => {
            if (submitInFlight) {
              return
            }
            submitInFlight = true
            void (async () => {
              try {
                const shouldExit = await handleInput(
                  permissionArgs,
                  state,
                  rerender,
                  submittedInput,
                )
                if (shouldExit) {
                  finish()
                  return
                }
                rerender()
              } catch (error) {
                pushTranscriptEntry(state, {
                  kind: 'assistant',
                  body: error instanceof Error ? error.message : String(error),
                })
                state.input = ''
                state.cursorOffset = 0
                state.selectedSlashIndex = 0
                state.status = null
                rerender()
              } finally {
                submitInFlight = false
              }
            })()
          },
        )
      } catch (error) {
        pushTranscriptEntry(state, {
          kind: 'assistant',
          body: error instanceof Error ? error.message : String(error),
        })
        state.input = ''
        state.cursorOffset = 0
        state.selectedSlashIndex = 0
        state.status = null
        rerender()
      }
      }

      const onData = (chunk: Buffer | string) => {
        const parsed = parseInputChunk(inputRemainder, chunk)
        inputRemainder = parsed.rest
        eventChain = eventChain.then(async () => {
          for (const event of parsed.events) {
            await handleEvent(event)
          }
        }).catch(error => {
          pushTranscriptEntry(state, {
            kind: 'assistant',
            body: error instanceof Error ? error.message : String(error),
          })
          state.input = ''
          state.cursorOffset = 0
          state.selectedSlashIndex = 0
          state.status = null
          rerender()
        })
      }

      const onEnd = () => finish()
      const onClose = () => finish()
      process.stdin.on('data', onData)
      process.stdin.once('end', onEnd)
      process.stdin.once('close', onClose)
      scope.addFinalizer(() => {
        cleanup()
      })
    })
  })
}
