import type { ChatMessage, ModelAdapter } from '@/types.js'
import {
  CLEARED_TOOL_OUTPUT,
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

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create a concise but thorough summary of the conversation so far, preserving all essential context needed to continue the work seamlessly.

Produce a summary with these sections:

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

/**
 * Compacts a conversation by sending it to the model for summarization.
 *
 * 1. Runs micro-compaction first to reduce bulk.
 * 2. Strips system messages from the conversation (they'll be re-injected on next turn).
 * 3. Sends the entire remaining conversation + summary prompt to the model.
 * 4. Replaces old messages with: `[system-prompt]`, `[summary-as-user]`, `[ack-as-assistant]`,
 *    plus the most recent user message (if any) so the model knows what to continue.
 *
 * Returns the compacted messages array, or null if compaction fails.
 */
export async function compactConversation(args: {
  model: ModelAdapter
  messages: ChatMessage[]
  onProgress?: (status: string) => void
}): Promise<ChatMessage[] | null> {
  const { model, messages, onProgress } = args

  // Step 1: micro-compact
  onProgress?.('micro-compacting old tool outputs...')
  const { messages: pruned } = microCompact(messages)

  // Step 2: Extract system messages (will be re-injected by the caller)
  const systemMessages = pruned.filter(m => m.role === 'system')
  const conversationMessages = pruned.filter(m => m.role !== 'system')

  if (conversationMessages.length < 4) {
    // Too few messages to compact meaningfully
    return null
  }

  // Step 3: Build the conversation text for the summarizer
  onProgress?.('generating conversation summary...')
  const summaryRequest: ChatMessage[] = [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    ...conversationMessages,
    {
      role: 'user',
      content:
        'Now create a structured summary of the entire conversation above. Follow the format specified in the system prompt exactly.',
    },
  ]

  try {
    const step = await model.next(summaryRequest)

    if (step.type !== 'assistant' || !step.content.trim()) {
      onProgress?.('compaction failed: model returned empty or non-text response')
      return null
    }

    const summary = step.content.trim()

    // Step 4: Find the most recent user message to preserve continuity
    const lastUserMsg = [...conversationMessages]
      .reverse()
      .find(m => m.role === 'user')

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
    ]

    // If there's a recent user message that differs from the summary prompt,
    // re-inject it so the model knows the current task
    if (
      lastUserMsg &&
      !lastUserMsg.content.includes('create a structured summary')
    ) {
      compacted.push({
        role: 'user',
        content: lastUserMsg.content,
      })
    }

    onProgress?.('compaction complete')
    return compacted
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    onProgress?.(`compaction failed: ${msg}`)
    return null
  }
}
