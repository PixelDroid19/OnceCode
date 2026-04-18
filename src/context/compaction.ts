import type { ChatMessage, ModelAdapter } from '@/types.js'
import {
  CLEARED_TOOL_OUTPUT,
  COMPACT_MAX_OUTPUT_TOKENS,
  COMPACT_SUMMARIZE_RATIO,
  MICRO_COMPACT_PROTECT_TURNS,
} from '@/constants.js'
import { estimateTokenCount } from './window.js'

// ── Micro-compaction ────────────────────────────────────────────────

/**
 * Prunes old tool_result outputs to reduce context size without an API call.
 *
 * Walks backwards through messages, counting user turns. Tool results
 * beyond the protection window (last N user turns) have their content
 * replaced with a placeholder. Only large outputs (>200 chars) are
 * cleared — tiny results are kept as-is since they cost almost nothing.
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
    if (
      i < protectBoundary &&
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
    } else {
      result.push(msg)
    }
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
}

/**
 * Finds the split point for compaction: the position of a user message
 * boundary at approximately `ratio` through the conversation (by character
 * count). Only the older portion (before the split) is sent for summarization;
 * the recent portion is kept verbatim.
 *
 * Returns the index of the first message in the "recent" portion,
 * or `messages.length` if no suitable split point is found.
 */
function findSplitPoint(
  messages: ChatMessage[],
  ratio: number,
): number {
  // Calculate total character count across all messages
  let totalChars = 0
  for (const msg of messages) {
    totalChars += 'content' in msg && typeof msg.content === 'string'
      ? msg.content.length
      : 0
  }

  const targetChars = totalChars * ratio
  let cumulativeChars = 0

  // Walk forward to find the point where we've accumulated ~ratio of total chars
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    cumulativeChars += 'content' in msg && typeof msg.content === 'string'
      ? msg.content.length
      : 0

    // Only split on user message boundaries (after accumulating enough chars)
    if (cumulativeChars >= targetChars && msg.role === 'user') {
      // Split AFTER this user message — include it in the old portion
      return i + 1
    }
  }

  // If no good split found, fall back to the nearest user message after target
  cumulativeChars = 0
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    cumulativeChars += 'content' in msg && typeof msg.content === 'string'
      ? msg.content.length
      : 0
    if (cumulativeChars >= targetChars) {
      // Find the next user message boundary
      for (let j = i; j < messages.length; j++) {
        if (messages[j]!.role === 'user') {
          return j + 1
        }
      }
      break
    }
  }

  // No suitable split — summarize everything
  return messages.length
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
 * 3. Finds a split point at ~70% of conversation chars on a user message boundary.
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
  const summaryRequest: ChatMessage[] = [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    ...messagesToSummarize,
    {
      role: 'user',
      content:
        'Now create a structured summary of the entire conversation above. Follow the format specified in the system prompt exactly. Begin with the <analysis> scratchpad, then produce the structured summary.',
    },
  ]

  try {
    const step = await model.next(summaryRequest, {
      maxOutputTokens: COMPACT_MAX_OUTPUT_TOKENS,
      includeTools: false,
    })

    if (step.type !== 'assistant' || !step.content.trim()) {
      onProgress?.('compaction failed: model returned empty or non-text response')
      return null
    }

    // Strip <analysis> scratchpad from the summary
    const summary = stripAnalysisScratchpad(step.content)

    if (!summary) {
      onProgress?.('compaction failed: summary was empty after stripping analysis')
      return null
    }

    // Step 5: Build compacted messages
    const compacted: ChatMessage[] = [
      // Re-inject system messages
      ...systemMessages,
      // Summary as context
      {
        role: 'user',
        content: [
          'This session is being continued from a previous conversation that was automatically compacted to save context space.',
          'Here is a summary of the work so far:',
          '',
          summary,
          '',
          'Continue from where we left off. Do not repeat work already done.',
        ].join('\n'),
      },
      {
        role: 'assistant',
        content:
          'I understand the context from the summary. I\'ll continue from where we left off without repeating completed work.',
      },
      // Append the recent (un-summarized) messages verbatim
      ...keepRecent,
    ]

    const afterCount = compacted.length
    const estimatedSummaryTokens = estimateTokenCount(summary)
    const estimatedOldTokens = messagesToSummarize.reduce(
      (sum, m) => sum + ('content' in m && typeof m.content === 'string' ? estimateTokenCount(m.content) : 0),
      0,
    )
    const freedTokens = microFreed + Math.max(0, estimatedOldTokens - estimatedSummaryTokens)

    onProgress?.('compaction complete')
    return { messages: compacted, beforeCount, afterCount, freedTokens }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    onProgress?.(`compaction failed: ${msg}`)
    return null
  }
}
