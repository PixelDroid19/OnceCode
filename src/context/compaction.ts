import type { ChatMessage, ModelAdapter } from '@/types.js'
import {
  CLEARED_TOOL_OUTPUT,
  COMPACTED_PROGRESS_MESSAGE,
  COMPACTED_TOOL_CALL_INPUT,
  COMPACT_MAX_OUTPUT_TOKENS,
  COMPACT_MAX_RETRIES,
  COMPACT_RETRY_DROP_RATIO,
  COMPACT_SUMMARIZE_RATIO,
  COMPACT_WORKING_MEMORY_MAX_TOKENS,
  MIN_PROGRESS_MESSAGE_CHARS,
  MIN_TOOL_CALL_INPUT_CHARS,
  MICRO_COMPACT_PROTECT_TURNS,
} from '@/constants.js'
import { estimateMessagesTokenCount, estimateTokenCount } from './window.js'

// ── Micro-compaction ────────────────────────────────────────────────

/**
 * Prunes old bulky messages to reduce context size without an API call.
 *
 * Walks backwards through messages, counting user turns. Messages beyond the
 * protection window (last N user turns) are selectively compacted:
 * - large `tool_result` outputs are replaced with a placeholder
 * - large `assistant_tool_call.input` payloads are replaced with a placeholder
 * - large `assistant_progress` messages are replaced with a placeholder
 * Tiny messages are kept as-is since they cost almost nothing.
 *
 * Returns a new array (never mutates the input) and the estimated
 * number of tokens freed.
 */
export function microCompact(
  messages: ChatMessage[],
  protectTurns: number = MICRO_COMPACT_PROTECT_TURNS,
): { messages: ChatMessage[]; freedTokens: number } {
  // Find the boundary: count user turns from the end
  let userTurnsSeen = 0
  let protectBoundary = 0 // default: everything is protected (nothing to clear)
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      userTurnsSeen++
      if (userTurnsSeen > protectTurns) {
        protectBoundary = i + 1 // messages before this index are old
        break
      }
    }
  }

  let freedTokens = 0
  const result: ChatMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (i >= protectBoundary) {
      result.push(msg)
      continue
    }

    if (
      msg.role === 'tool_result' &&
      msg.content.length > 200 &&
      msg.content !== CLEARED_TOOL_OUTPUT
    ) {
      const before = estimateTokenCount(msg.content)
      const after = estimateTokenCount(CLEARED_TOOL_OUTPUT)
      freedTokens += Math.max(0, before - after)
      result.push({
        ...msg,
        content: CLEARED_TOOL_OUTPUT,
      })
      continue
    }

    if (msg.role === 'assistant_tool_call') {
      const inputText = JSON.stringify(msg.input)
      if (inputText.length > MIN_TOOL_CALL_INPUT_CHARS) {
        const before = estimateTokenCount(inputText)
        const after = estimateTokenCount(COMPACTED_TOOL_CALL_INPUT)
        freedTokens += Math.max(0, before - after)
        result.push({
          ...msg,
          input: COMPACTED_TOOL_CALL_INPUT,
        })
        continue
      }
    }

    if (
      msg.role === 'assistant_progress' &&
      msg.content.length > MIN_PROGRESS_MESSAGE_CHARS &&
      msg.content !== COMPACTED_PROGRESS_MESSAGE
    ) {
      const before = estimateTokenCount(msg.content)
      const after = estimateTokenCount(COMPACTED_PROGRESS_MESSAGE)
      freedTokens += Math.max(0, before - after)
      result.push({
        ...msg,
        content: COMPACTED_PROGRESS_MESSAGE,
      })
      continue
    }

    result.push(msg)
  }

  return { messages: result, freedTokens }
}

// ── Full compaction (summarization) ─────────────────────────────────

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer for a coding assistant session. Your task is to create a concise but thorough summary of the conversation so far, preserving all essential context needed to continue the work seamlessly.

First, analyze the conversation inside an <analysis> scratchpad (this will be stripped from the final output):

<analysis>
- What is the user's primary goal?
- What constraints and instructions did the user give?
- What key technical discoveries were made?
- What files were modified and how?
- What is currently in progress or pending?
</analysis>

Then produce a structured summary with these sections:

## Goal
The user's primary request and intent.

## Instructions
Important constraints, preferences, or instructions given by the user that must be maintained going forward.

## Discoveries
Key technical findings, codebase patterns, and important context discovered during the conversation.

## Accomplished
Work completed so far, including specific files modified and changes made. Be precise with file paths and what was done.

## Current State
What was being worked on when the conversation was compacted, any pending items or next steps.

## Relevant Files
Important file paths and their roles in the task.

RULES:
- Be concise but thorough — the model that reads this summary must be able to continue the work seamlessly.
- Include specific file paths, function names, and code patterns when relevant.
- Preserve ALL user requirements and constraints — losing these would be catastrophic.
- Do NOT include redundant information or repeat tool outputs verbatim.
- Do NOT include conversational filler or meta-commentary about the summary itself.
- Write in a direct, factual style.`

/** Result metadata returned by `compactConversation`. */
export interface CompactionResult {
  messages: ChatMessage[]
  beforeCount: number
  afterCount: number
  freedTokens: number
  postCompactTokens: number
  workingMemory: string
  summarizedMessageCount: number
  preservedRecentMessageCount: number
}

type WorkingMemory = {
  goal: string[]
  constraints: string[]
  files: string[]
  nextSteps: string[]
}

/**
 * Finds the split point for compaction: the position of a user message
 * boundary at approximately `ratio` through the conversation (by estimated
 * tokens). Only the older portion (before the split) is sent for summarization;
 * the recent portion is kept verbatim.
 *
 * Returns the index of the first message in the "recent" portion,
 * or `messages.length` if no suitable split point is found.
 */
function findSplitPoint(
  messages: ChatMessage[],
  ratio: number,
): number {
  const totalTokens = estimateMessagesTokenCount(messages)
  const targetTokens = totalTokens * ratio
  let cumulativeTokens = 0

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    cumulativeTokens += estimateMessagesTokenCount([msg])
    if (cumulativeTokens >= targetTokens && msg.role === 'user') {
      return i > 0 ? i : 1
    }
  }

  cumulativeTokens = 0
  for (let i = 0; i < messages.length; i++) {
    cumulativeTokens += estimateMessagesTokenCount([messages[i]!])
    if (cumulativeTokens >= targetTokens) {
      for (let j = i; j < messages.length; j++) {
        if (messages[j]!.role === 'user') {
          return j > 0 ? j : 1
        }
      }
      return i + 1
    }
  }

  return messages.length
}

const REQUIRED_SUMMARY_SECTIONS = [
  '## Goal',
  '## Instructions',
  '## Discoveries',
  '## Accomplished',
  '## Current State',
  '## Relevant Files',
]

function isStructuredSummary(summary: string): boolean {
  return REQUIRED_SUMMARY_SECTIONS.every(section => summary.includes(section))
}

function wrapUnstructuredSummary(summary: string): string {
  const trimmed = summary.trim()
  return [
    '## Goal',
    'Continue the task described in the prior session.',
    '',
    '## Instructions',
    'Preserve user constraints and do not repeat completed work.',
    '',
    '## Discoveries',
    trimmed || 'No discoveries were preserved.',
    '',
    '## Accomplished',
    'See discoveries above for the preserved context.',
    '',
    '## Current State',
    'Resume from the latest preserved work and verify remaining steps before continuing.',
    '',
    '## Relevant Files',
    'Files were not extracted into a structured list by the summarizer.',
  ].join('\n')
}

function extractSummarySection(summary: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = summary.match(
    new RegExp(`${escapedHeading}\\n([\\s\\S]*?)(?=\\n## |$)`),
  )
  return match?.[1]?.trim() ?? ''
}

function collectFilePaths(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? []
  return [...new Set(matches)]
}

function takeBulletLikeLines(text: string, limit: number): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, limit)
}

function buildWorkingMemory(summary: string): WorkingMemory {
  const goal = takeBulletLikeLines(extractSummarySection(summary, '## Goal'), 3)
  const constraints = takeBulletLikeLines(extractSummarySection(summary, '## Instructions'), 6)
  const discoveries = extractSummarySection(summary, '## Discoveries')
  const currentState = extractSummarySection(summary, '## Current State')
  const relevantFiles = extractSummarySection(summary, '## Relevant Files')

  const files = [...new Set([
    ...collectFilePaths(discoveries),
    ...collectFilePaths(currentState),
    ...collectFilePaths(relevantFiles),
  ])].slice(0, 12)

  const nextSteps = takeBulletLikeLines(currentState, 6)

  return {
    goal,
    constraints,
    files,
    nextSteps,
  }
}

function formatWorkingMemory(memory: WorkingMemory): string {
  const lines = [
    '## Working Memory',
    memory.goal.length > 0 ? `Goal: ${memory.goal.join(' ')}` : 'Goal: preserve the active task context.',
    memory.constraints.length > 0
      ? `Constraints: ${memory.constraints.join(' | ')}`
      : 'Constraints: preserve user requirements and avoid repeating completed work.',
    memory.files.length > 0
      ? `Active files: ${memory.files.join(', ')}`
      : 'Active files: none extracted.',
    memory.nextSteps.length > 0
      ? `Next focus: ${memory.nextSteps.join(' | ')}`
      : 'Next focus: inspect the latest preserved conversation turns before continuing.',
  ]

  let text = lines.join('\n')
  while (estimateTokenCount(text) > COMPACT_WORKING_MEMORY_MAX_TOKENS && lines.length > 2) {
    lines.pop()
    text = lines.join('\n')
  }
  return text
}

function buildSummaryRequest(messagesToSummarize: ChatMessage[]): ChatMessage[] {
  return [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    ...messagesToSummarize,
    {
      role: 'user',
      content:
        'Now create a structured summary of the entire conversation above. Follow the format specified in the system prompt exactly. Begin with the <analysis> scratchpad, then produce the structured summary.',
    },
  ]
}

async function summarizeConversationChunk(args: {
  model: ModelAdapter
  messagesToSummarize: ChatMessage[]
}): Promise<string | null> {
  const step = await args.model.next(buildSummaryRequest(args.messagesToSummarize), {
    maxOutputTokens: COMPACT_MAX_OUTPUT_TOKENS,
    includeTools: false,
  })

  if (step.type !== 'assistant' || !step.content.trim()) {
    return null
  }

  const stripped = stripAnalysisScratchpad(step.content)
  if (!stripped) {
    return null
  }

  return isStructuredSummary(stripped)
    ? stripped
    : wrapUnstructuredSummary(stripped)
}

function createCompactedMessages(args: {
  systemMessages: ChatMessage[]
  summary: string
  workingMemory: string
  keepRecent: ChatMessage[]
}): ChatMessage[] {
  return [
    ...args.systemMessages,
    {
      role: 'user',
      content: [
          'This session is being continued from a previous conversation that was automatically compacted to save context space.',
          'Here is a summary of the work so far:',
          '',
          args.summary,
          '',
          args.workingMemory,
          '',
          'Continue from where we left off. Do not repeat work already done.',
        ].join('\n'),
    },
    {
      role: 'assistant',
      content:
        'I understand the context from the summary. I\'ll continue from where we left off without repeating completed work.',
    },
    ...args.keepRecent,
  ]
}

export function compactConversationBaseline(args: {
  messages: ChatMessage[]
  summary: string
}): CompactionResult | null {
  const beforeCount = args.messages.length
  const { messages: pruned, freedTokens: microFreed } = microCompact(args.messages)
  const systemMessages = pruned.filter(m => m.role === 'system')
  const conversationMessages = pruned.filter(m => m.role !== 'system')

  if (conversationMessages.length < 4) {
    return null
  }

  const compacted = createCompactedMessages({
    systemMessages,
    summary: args.summary.trim(),
    workingMemory: formatWorkingMemory(buildWorkingMemory(args.summary)),
    keepRecent: [],
  })

  const afterCount = compacted.length
  const estimatedSummaryTokens = estimateTokenCount(args.summary)
  const estimatedOldTokens = conversationMessages.reduce(
    (sum, m) => sum + estimateMessagesTokenCount([m]),
    0,
  )
  const freedTokens = microFreed + Math.max(0, estimatedOldTokens - estimatedSummaryTokens)
  const postCompactTokens = estimateMessagesTokenCount(compacted)

  return {
    messages: compacted,
    beforeCount,
    afterCount,
    freedTokens,
    postCompactTokens,
    workingMemory: formatWorkingMemory(buildWorkingMemory(args.summary)),
    summarizedMessageCount: conversationMessages.length,
    preservedRecentMessageCount: 0,
  }
}

function shrinkSummarizeSet(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 4) {
    return messages
  }

  const dropCount = Math.max(1, Math.floor(messages.length * COMPACT_RETRY_DROP_RATIO))
  const truncated = messages.slice(dropCount)

  if (truncated[0]?.role === 'assistant') {
    return [
      {
        role: 'user',
        content: '[Earlier conversation truncated during compaction retry]',
      },
      ...truncated,
    ]
  }

  return truncated
}

function ensureMinimumSummarizeSet(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length >= 4) {
    return messages
  }

  const padded: ChatMessage[] = [...messages]
  while (padded.length < 4) {
    padded.unshift({
      role: 'user',
      content: '[Earlier conversation truncated during compaction retry]',
    })
  }
  return padded
}

function isRetryableCompactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return normalized.includes('prompt too long') ||
    normalized.includes('context length') ||
    normalized.includes('too many tokens') ||
    normalized.includes('maximum context')
}

async function summarizeWithRetry(args: {
  model: ModelAdapter
  messagesToSummarize: ChatMessage[]
  onProgress?: (status: string) => void
}): Promise<{ summary: string; summarizedMessages: ChatMessage[] } | null> {
  let candidateMessages = args.messagesToSummarize

  for (let attempt = 0; attempt < COMPACT_MAX_RETRIES; attempt++) {
    try {
      const summary = await summarizeConversationChunk({
        model: args.model,
        messagesToSummarize: candidateMessages,
      })
      if (summary) {
        return { summary, summarizedMessages: candidateMessages }
      }
      return null
    } catch (error) {
      if (!isRetryableCompactionError(error) || candidateMessages.length <= 4) {
        if (candidateMessages.length <= 4 && isRetryableCompactionError(error)) {
          candidateMessages = ensureMinimumSummarizeSet(candidateMessages)
          continue
        }
        throw error
      }

      candidateMessages = ensureMinimumSummarizeSet(
        shrinkSummarizeSet(candidateMessages),
      )
      args.onProgress?.(
        `compaction retry ${attempt + 1}/${COMPACT_MAX_RETRIES}: reducing older context...`,
      )
    }
  }

  return null
}

/**
 * Strips the `<analysis>...</analysis>` scratchpad block from a summary,
 * since it's only meant as a thinking aid for the summarizer model.
 */
function stripAnalysisScratchpad(summary: string): string {
  return summary.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim()
}

/**
 * Compacts a conversation by sending it to the model for summarization.
 *
 * 1. Runs micro-compaction first to reduce bulk.
 * 2. Strips system messages from the conversation (they'll be re-injected on next turn).
 * 3. Finds a split point at ~70% of conversation tokens on a user message boundary.
 * 4. Sends only the older portion + summary prompt to the model (no tools, capped output).
 * 5. Builds compacted messages: `[system]`, `[summary-as-user]`, `[ack-as-assistant]`,
 *    plus the recent portion verbatim.
 *
 * Returns a `CompactionResult` with metadata, or `null` if compaction fails.
 */
export async function compactConversation(args: {
  model: ModelAdapter
  messages: ChatMessage[]
  onProgress?: (status: string) => void
}): Promise<CompactionResult | null> {
  const { model, messages, onProgress } = args
  const beforeCount = messages.length

  // Step 1: micro-compact
  onProgress?.('micro-compacting old tool outputs...')
  const { messages: pruned, freedTokens: microFreed } = microCompact(messages)

  // Step 2: Extract system messages (will be re-injected by the caller)
  const systemMessages = pruned.filter(m => m.role === 'system')
  const conversationMessages = pruned.filter(m => m.role !== 'system')

  if (conversationMessages.length < 4) {
    // Too few messages to compact meaningfully
    return null
  }

  // Step 3: Find split point — summarize ~70%, keep ~30% recent
  const splitIndex = findSplitPoint(conversationMessages, COMPACT_SUMMARIZE_RATIO)
  const olderMessages = conversationMessages.slice(0, splitIndex)
  const recentMessages = conversationMessages.slice(splitIndex)

  // If the older portion is too small, summarize everything
  const messagesToSummarize = olderMessages.length >= 4
    ? olderMessages
    : conversationMessages

  const keepRecent = olderMessages.length >= 4
    ? recentMessages
    : []

  // Step 4: Build the summarization request (no tools, capped output)
  onProgress?.('generating conversation summary...')

  try {
    const summaryResult = await summarizeWithRetry({
      model,
      messagesToSummarize,
      onProgress,
    })

    if (!summaryResult) {
      onProgress?.('compaction failed: model returned empty or non-text response')
      return null
    }

    const { summary, summarizedMessages } = summaryResult
    const workingMemory = formatWorkingMemory(buildWorkingMemory(summary))

    // Step 5: Build compacted messages
    const compacted = createCompactedMessages({
      systemMessages,
      summary,
      workingMemory,
      keepRecent,
    })

    const afterCount = compacted.length
    const estimatedSummaryTokens = estimateTokenCount(summary)
    const estimatedOldTokens = summarizedMessages.reduce(
      (sum, m) => sum + estimateMessagesTokenCount([m]),
      0,
    )
    const freedTokens = microFreed + Math.max(0, estimatedOldTokens - estimatedSummaryTokens)
    const postCompactTokens = estimateMessagesTokenCount(compacted)

    onProgress?.('compaction complete')
    return {
      messages: compacted,
      beforeCount,
      afterCount,
      freedTokens,
      postCompactTokens,
      workingMemory,
      summarizedMessageCount: summarizedMessages.length,
      preservedRecentMessageCount: keepRecent.length,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    onProgress?.(`compaction failed: ${msg}`)
    return null
  }
}
