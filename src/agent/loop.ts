/**
 * Agent turn loop.
 *
 * Drives a model adapter in a loop — calling `next()`, executing any
 * returned tool calls (with parallel batching for read-only tools),
 * and continuing until the model produces a final assistant response
 * or the step limit is reached.
 */

import type { ToolRegistry, ToolResult } from '@/tools/framework.js'
import type { ChatMessage, ModelAdapter, TokenUsage, ToolCall } from '@/types.js'
import type { PermissionManager } from '@/permissions/manager.js'
import { t } from '@/i18n/index.js'
import { isAbortError } from '@/utils/abort.js'

/** Maximum number of read-only tools to execute in parallel. */
const MAX_PARALLEL_TOOLS = 5

function isEmptyAssistantResponse(content: string): boolean {
  return content.trim().length === 0
}

function shouldTreatAssistantAsProgress(args: {
  kind?: 'final' | 'progress'
  content: string
  sawToolResultThisTurn: boolean
}): boolean {
  if (args.kind === 'progress') {
    return true
  }

  if (args.kind === 'final') {
    return false
  }

  if (!args.sawToolResultThisTurn) {
    return false
  }

  return false
}

function formatDiagnostics(args: {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}): string {
  const parts: string[] = []

  if (args.stopReason) {
    parts.push(`stop_reason=${args.stopReason}`)
  }

  if ((args.blockTypes?.length ?? 0) > 0) {
    parts.push(`blocks=${args.blockTypes!.join(',')}`)
  }

  if ((args.ignoredBlockTypes?.length ?? 0) > 0) {
    parts.push(`ignored=${args.ignoredBlockTypes!.join(',')}`)
  }

  return parts.length > 0
    ? ` ${t('agent_diagnostics', { details: parts.join('; ') })}`
    : ''
}

function isRecoverableThinkingStop(args: {
  isEmpty: boolean
  stopReason?: string
  ignoredBlockTypes?: string[]
}): boolean {
  if (!args.isEmpty) {
    return false
  }

  if (args.stopReason !== 'pause_turn' && args.stopReason !== 'max_tokens') {
    return false
  }

  return (args.ignoredBlockTypes ?? []).includes('thinking')
}

/** Drives the model in a loop, executing tool calls until the agent yields a final response. */
export async function runAgentTurn(args: {
  model: ModelAdapter
  tools: ToolRegistry
  messages: ChatMessage[]
  cwd: string
  permissions?: PermissionManager
  maxSteps?: number
  signal?: AbortSignal
  onTextDelta?: (text: string) => void
  onToolStart?: (toolName: string, input: unknown) => void
  onToolResult?: (toolName: string, output: string, isError: boolean) => void
  onAssistantMessage?: (content: string) => void
  onProgressMessage?: (content: string) => void
  onUsageUpdate?: (usage: TokenUsage) => void
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps
  let messages = args.messages
  let emptyResponseRetryCount = 0
  let recoverableThinkingRetryCount = 0
  let toolErrorCount = 0
  let sawToolResultThisTurn = false

  const pushContinuationPrompt = (content: string) => {
    messages = [
      ...messages,
      {
        role: 'user',
        content,
      },
    ]
  }

  for (let step = 0; maxSteps == null || step < maxSteps; step++) {
    // Check for cancellation at each iteration
    if (args.signal?.aborted) {
      return [
        ...messages,
        { role: 'assistant', content: t('agent_cancelled') },
      ]
    }

    let next
    try {
      next = await args.model.next(messages, {
        signal: args.signal,
        onTextDelta: args.onTextDelta,
      })
    } catch (error) {
      if (args.signal?.aborted || isAbortError(error)) {
        return [
          ...messages,
          { role: 'assistant', content: t('agent_cancelled') },
        ]
      }
      throw error
    }

    // Report usage to the tracker after every API call
    if (next.usage) {
      args.onUsageUpdate?.(next.usage)
    }

    if (next.type === 'assistant') {
      const isEmpty = isEmptyAssistantResponse(next.content)
      if (
        !isEmpty &&
        shouldTreatAssistantAsProgress({
          kind: next.kind,
          content: next.content,
          sawToolResultThisTurn,
        })
      ) {
        args.onProgressMessage?.(next.content)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: next.content },
        ]
        pushContinuationPrompt(
          sawToolResultThisTurn && next.kind !== 'progress'
            ? 'Continue from your progress update. You have already used tools in this turn, so treat plain status text as progress, not a final answer. Respond with the next concrete tool call, code change, or an explicit <final> answer only if the task is truly complete.'
            : 'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (
        isRecoverableThinkingStop({
          isEmpty,
          stopReason: next.diagnostics?.stopReason,
          ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
        }) &&
        recoverableThinkingRetryCount < 3
      ) {
        recoverableThinkingRetryCount += 1
        const stopReason = next.diagnostics?.stopReason
        const progressContent =
          stopReason === 'max_tokens'
            ? t('agent_max_tokens_thinking')
            : t('agent_pause_turn')
        args.onProgressMessage?.(progressContent)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: progressContent },
        ]
        pushContinuationPrompt(
          stopReason === 'max_tokens'
            ? 'Your previous response hit max_tokens during thinking before producing the next actionable step. Resume immediately and continue with the next concrete tool call, code change, or an explicit <final> answer only if the task is complete. Do not repeat the earlier plan.'
            : 'Resume from the previous pause_turn and continue the task immediately. Produce the next concrete tool call, code change, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (isEmpty && emptyResponseRetryCount < 2) {
        emptyResponseRetryCount += 1
        pushContinuationPrompt(
          sawToolResultThisTurn
            ? 'Your last response was empty after recent tool results. Continue immediately by trying the next concrete step, adapting to any tool errors, or giving an explicit <final> answer only if the task is complete.'
            : 'Your last response was empty. Continue immediately with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (isEmpty) {
        const diagnosticsSuffix = formatDiagnostics({
          stopReason: next.diagnostics?.stopReason,
          blockTypes: next.diagnostics?.blockTypes,
          ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
        })
        const fallbackContent =
          sawToolResultThisTurn
            ? toolErrorCount > 0
              ? t('agent_empty_response_with_errors', {
                  count: toolErrorCount,
                  diagnostics: diagnosticsSuffix,
                })
              : t('agent_empty_response_after_tools', {
                  diagnostics: diagnosticsSuffix,
                })
            : t('agent_empty_response', {
                diagnostics: diagnosticsSuffix,
              })

        args.onAssistantMessage?.(fallbackContent)
        return [
          ...messages,
          {
            role: 'assistant',
            content: fallbackContent,
          },
        ]
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: next.content,
      }
      const withAssistant: ChatMessage[] = [
        ...messages,
        assistantMessage,
      ]

      if (!isEmpty) {
        args.onAssistantMessage?.(next.content)
      }

      return withAssistant
    }

    if (next.content) {
      if (next.contentKind === 'progress') {
        args.onProgressMessage?.(next.content)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: next.content },
        ]
        pushContinuationPrompt(
          'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
      } else {
        args.onAssistantMessage?.(next.content)
        messages = [
          ...messages,
          { role: 'assistant', content: next.content },
        ]
      }
    }

    if ((next.calls?.length ?? 0) === 0 && next.content && next.contentKind !== 'progress') {
      return messages
    }

    // ── Parallel/sequential tool execution ────────────────────────
    // Partition calls into contiguous batches: read-only calls can run
    // in parallel, mutating calls run one at a time and flush any
    // pending read-only batch first.
    const callResults = await executeBatchedToolCalls({
      calls: next.calls,
      tools: args.tools,
      cwd: args.cwd,
      permissions: args.permissions,
      signal: args.signal,
      onToolStart: args.onToolStart,
      onToolResult: args.onToolResult,
    })

    let earlyReturn = false
    for (const item of callResults) {
      sawToolResultThisTurn = true
      if (!item.result.ok) {
        toolErrorCount += 1
      }

      messages = [
        ...messages,
        {
          role: 'assistant_tool_call',
          toolUseId: item.call.id,
          toolName: item.call.toolName,
          input: item.call.input,
        },
        {
          role: 'tool_result',
          toolUseId: item.call.id,
          toolName: item.call.toolName,
          content: item.result.output,
          isError: !item.result.ok,
        },
      ]

      if (item.result.awaitUser) {
        const question = item.result.output.trim()
        if (question.length > 0) {
          args.onAssistantMessage?.(question)
          messages = [
            ...messages,
            {
              role: 'assistant',
              content: question,
            },
          ]
        }
        earlyReturn = true
        break
      }
    }

    if (earlyReturn) {
      return messages
    }
  }

  const maxStepContent = t('agent_max_steps')
  args.onAssistantMessage?.(maxStepContent)
  return [
    ...messages,
    {
      role: 'assistant',
      content: maxStepContent,
    },
  ]
}

// ── Batched parallel/sequential tool execution ───────────────────

type CallResult = {
  call: ToolCall
  result: ToolResult
}

/**
 * Executes tool calls with optimal concurrency:
 * - Consecutive read-only calls run in parallel (up to MAX_PARALLEL_TOOLS)
 * - Mutating calls run sequentially, flushing any pending read-only batch first
 * - Order of results matches the original call order
 */
async function executeBatchedToolCalls(args: {
  calls: ToolCall[]
  tools: ToolRegistry
  cwd: string
  permissions?: PermissionManager
  signal?: AbortSignal
  onToolStart?: (toolName: string, input: unknown) => void
  onToolResult?: (toolName: string, output: string, isError: boolean) => void
}): Promise<CallResult[]> {
  const results: CallResult[] = []
  let readOnlyBatch: ToolCall[] = []

  const flushReadOnlyBatch = async () => {
    if (readOnlyBatch.length === 0) return

    const batch = readOnlyBatch
    readOnlyBatch = []

    for (const call of batch) {
      args.onToolStart?.(call.toolName, call.input)
    }

    // Execute in parallel with concurrency cap
    const batchResults = await executeParallel(
      batch,
      call => args.tools.execute(call.toolName, call.input, {
        cwd: args.cwd,
        permissions: args.permissions,
        signal: args.signal,
      }),
      MAX_PARALLEL_TOOLS,
    )

    for (let i = 0; i < batch.length; i++) {
      const call = batch[i]
      const result = batchResults[i]
      args.onToolResult?.(call.toolName, result.output, !result.ok)
      results.push({ call, result })
    }
  }

  for (const call of args.calls) {
    if (args.tools.isReadOnly(call.toolName)) {
      readOnlyBatch.push(call)
    } else {
      // Flush pending read-only batch before running mutating call
      await flushReadOnlyBatch()

      args.onToolStart?.(call.toolName, call.input)
      const result = await args.tools.execute(call.toolName, call.input, {
        cwd: args.cwd,
        permissions: args.permissions,
        signal: args.signal,
      })
      args.onToolResult?.(call.toolName, result.output, !result.ok)
      results.push({ call, result })
    }
  }

  // Flush any remaining read-only batch
  await flushReadOnlyBatch()

  return results
}

/** Runs tasks in parallel with a concurrency cap, preserving order. */
async function executeParallel<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  maxConcurrency: number,
): Promise<R[]> {
  if (items.length <= 1) {
    return items.length === 0 ? [] : [await fn(items[0])]
  }

  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      results[idx] = await fn(items[idx])
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}
