import { describe, expect, it } from 'vitest'
import {
  getContextWindowSize,
  getEffectiveContextBudget,
  estimateTokenCount,
  estimateMessagesTokenCount,
  shouldCompact,
  shouldCompactNextTurn,
  getContextUsageFraction,
} from '@/context/window.js'
import { ContextTracker, formatTokenCount } from '@/context/tracker.js'
import type { ChatMessage, TokenUsage } from '@/types.js'
import { microCompact, compactConversation, compactConversationBaseline } from '@/context/compaction.js'
import {
  CLEARED_TOOL_OUTPUT,
  COMPACTED_PROGRESS_MESSAGE,
  COMPACTED_TOOL_CALL_INPUT,
} from '@/constants.js'

// ── Context window size rules ──────────────────────────────────────

describe('getContextWindowSize', () => {
  it('returns 200K for Anthropic models', () => {
    expect(getContextWindowSize('claude-sonnet-4')).toBe(200_000)
    expect(getContextWindowSize('claude-opus-4-6')).toBe(200_000)
    expect(getContextWindowSize('claude-3-5-sonnet-20241022')).toBe(200_000)
  })

  it('returns 128K for GPT-5', () => {
    expect(getContextWindowSize('gpt-5')).toBe(128_000)
  })

  it('returns 1M for Gemini 2.5', () => {
    expect(getContextWindowSize('gemini-2.5-pro')).toBe(1_000_000)
  })

  it('returns 128K for DeepSeek', () => {
    expect(getContextWindowSize('deepseek-chat')).toBe(128_000)
  })

  it('returns default for unknown models', () => {
    expect(getContextWindowSize('my-custom-model')).toBe(200_000)
  })
})

// ── Token estimation ────────────────────────────────────────────────

describe('estimateTokenCount', () => {
  it('estimates based on chars/4 ratio', () => {
    expect(estimateTokenCount('hello world')).toBe(3) // 11 chars / 4 = 2.75 → 3
    expect(estimateTokenCount('')).toBe(0)
    expect(estimateTokenCount('a'.repeat(400))).toBe(100)
  })
})

describe('estimateMessagesTokenCount', () => {
  it('sums content of all messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt here' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    const estimate = estimateMessagesTokenCount(messages)
    // Each message: content tokens + 4 overhead
    expect(estimate).toBeGreaterThan(0)
    expect(estimate).toBeLessThan(100)
  })
})

// ── Overflow detection ──────────────────────────────────────────────

describe('shouldCompact', () => {
  it('returns false when under threshold', () => {
    expect(shouldCompact('claude-sonnet-4', 50_000)).toBe(false)
  })

  it('returns true when at or above threshold', () => {
    // claude-sonnet-4: 200K context, 64K output, 20K buffer
    // effective budget = 200K - 64K - 20K = 116K
    expect(shouldCompact('claude-sonnet-4', 116_000)).toBe(true)
    expect(shouldCompact('claude-sonnet-4', 150_000)).toBe(true)
  })

  it('returns false for zero tokens', () => {
    expect(shouldCompact('claude-sonnet-4', 0)).toBe(false)
  })
})

describe('shouldCompactNextTurn', () => {
  it('predicts compaction when new messages push the next request over budget', () => {
    const alreadyCounted: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(1000) },
      { role: 'assistant', content: 'b'.repeat(1000) },
    ]
    const nextMessages: ChatMessage[] = [
      ...alreadyCounted,
      { role: 'user', content: 'x'.repeat(240_000) },
    ]
    expect(shouldCompactNextTurn({
      model: 'claude-sonnet-4',
      lastInputTokens: 60_000,
      alreadyCountedMessages: alreadyCounted,
      messages: nextMessages,
    })).toBe(true)
  })

  it('does not compact when the projected next request remains under budget', () => {
    const alreadyCounted: ChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]
    const nextMessages: ChatMessage[] = [
      ...alreadyCounted,
      { role: 'user', content: 'small input' },
    ]
    expect(shouldCompactNextTurn({
      model: 'claude-sonnet-4',
      lastInputTokens: 50_000,
      alreadyCountedMessages: alreadyCounted,
      messages: nextMessages,
    })).toBe(false)
  })
})

describe('getEffectiveContextBudget', () => {
  it('returns contextWindow - maxOutput - buffer', () => {
    const budget = getEffectiveContextBudget('claude-sonnet-4')
    // 200K - 64K - 20K = 116K
    expect(budget).toBe(116_000)
  })
})

describe('getContextUsageFraction', () => {
  it('returns 0-1 fraction', () => {
    expect(getContextUsageFraction('claude-sonnet-4', 100_000)).toBeCloseTo(0.5)
    expect(getContextUsageFraction('claude-sonnet-4', 0)).toBe(0)
    expect(getContextUsageFraction('claude-sonnet-4', 300_000)).toBe(1)
  })
})

// ── ContextTracker ──────────────────────────────────────────────────

describe('ContextTracker', () => {
  function makeUsage(inputTokens: number): TokenUsage {
    return {
      inputTokens,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }
  }

  it('starts at zero usage', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    expect(tracker.usagePercent).toBe(0)
    expect(tracker.warningLevel).toBe('normal')
    expect(tracker.shouldCompact()).toBe(false)
  })

  it('records usage and updates percentage', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.resetAfterCompaction(12_345)
    tracker.recordUsage(makeUsage(100_000))
    expect(tracker.usagePercent).toBe(50)
    expect(tracker.warningLevel).toBe('normal')
    expect(tracker.projectedPostCompactTokens).toBe(0)
  })

  it('detects warning level', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(130_000))
    expect(tracker.warningLevel).toBe('warning') // 65%
  })

  it('detects error level', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(170_000))
    expect(tracker.warningLevel).toBe('error') // 85%
  })

  it('detects compaction needed', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(120_000)) // above 116K threshold
    expect(tracker.shouldCompact()).toBe(true)
  })

  it('resets after compaction', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(150_000))
    expect(tracker.shouldCompact()).toBe(true)
    tracker.resetAfterCompaction(12_345)
    expect(tracker.shouldCompact()).toBe(false)
    expect(tracker.lastInputTokens).toBe(12_345)
    expect(tracker.projectedPostCompactTokens).toBe(12_345)
  })

  it('produces a snapshot with all fields', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(50_000))
    const snap = tracker.snapshot()
    expect(snap.model).toBe('claude-sonnet-4')
    expect(snap.contextWindow).toBe(200_000)
    expect(snap.maxOutputTokens).toBe(64_000)
    expect(snap.lastInputTokens).toBe(50_000)
    expect(snap.requestCount).toBe(1)
    expect(snap.usagePercent).toBe(25)
  })

  it('accumulates totals across multiple requests', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(10_000))
    tracker.recordUsage(makeUsage(20_000))
    const snap = tracker.snapshot()
    expect(snap.totalInputTokens).toBe(30_000)
    expect(snap.totalOutputTokens).toBe(1_000)
    expect(snap.requestCount).toBe(2)
    // lastInputTokens is the latest, not cumulative
    expect(snap.lastInputTokens).toBe(20_000)
  })

  it('includes cache tokens in context size', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage({
      inputTokens: 50_000,
      outputTokens: 500,
      cacheCreationInputTokens: 10_000,
      cacheReadInputTokens: 20_000,
    })
    // lastInputTokens = 50K + 10K + 20K = 80K
    expect(tracker.lastInputTokens).toBe(80_000)
    expect(tracker.usagePercent).toBe(40)
  })

  it('formatSummary produces readable output', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordUsage(makeUsage(50_000))
    const summary = tracker.formatSummary()
    expect(summary).toContain('claude-sonnet-4')
    expect(summary).toContain('200K')
    expect(summary).toContain('25%')
  })

  it('predicts next-turn compaction using pending messages', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    const alreadyCounted: ChatMessage[] = [
      { role: 'user', content: 'a'.repeat(1000) },
      { role: 'assistant', content: 'b'.repeat(1000) },
    ]
    const nextMessages: ChatMessage[] = [
      ...alreadyCounted,
      { role: 'user', content: 'x'.repeat(240_000) },
    ]
    tracker.recordUsage(makeUsage(60_000))
    expect(tracker.shouldCompactNextTurn(nextMessages, alreadyCounted)).toBe(true)
  })
})

// ── formatTokenCount ────────────────────────────────────────────────

describe('formatTokenCount', () => {
  it('formats thousands as K', () => {
    expect(formatTokenCount(1_000)).toBe('1K')
    expect(formatTokenCount(64_000)).toBe('64K')
    expect(formatTokenCount(200_000)).toBe('200K')
  })

  it('formats millions as M', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M')
  })

  it('formats decimals', () => {
    expect(formatTokenCount(1_500)).toBe('1.5K')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
  })

  it('formats small numbers as-is', () => {
    expect(formatTokenCount(500)).toBe('500')
    expect(formatTokenCount(0)).toBe('0')
  })
})

// ── Micro-compaction ────────────────────────────────────────────────

describe('microCompact', () => {
  it('clears old tool_result content beyond protection window', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'do something' },
      { role: 'assistant_tool_call', toolUseId: '1', toolName: 'read_file', input: {} },
      {
        role: 'tool_result',
        toolUseId: '1',
        toolName: 'read_file',
        content: 'x'.repeat(500), // large output
        isError: false,
      },
      { role: 'assistant', content: 'done with first task' },
      // --- user turn 1 ---
      { role: 'user', content: 'do more' },
      { role: 'assistant', content: 'ok' },
      // --- user turn 2 ---
      { role: 'user', content: 'keep going' },
      { role: 'assistant', content: 'sure' },
      // --- user turn 3 ---
      { role: 'user', content: 'and more' },
      { role: 'assistant', content: 'yes' },
      // --- user turn 4 (protected) ---
      { role: 'user', content: 'recent' },
      { role: 'assistant', content: 'fresh' },
    ]

    const { messages: result, freedTokens } = microCompact(messages, 3)
    expect(result.length).toBe(messages.length)

    // The old tool_result (before the 3 protected turns) should be cleared
    const clearedMsg = result[3]!
    expect(clearedMsg.role).toBe('tool_result')
    expect((clearedMsg as Extract<ChatMessage, { role: 'tool_result' }>).content).toBe(CLEARED_TOOL_OUTPUT)
    expect(freedTokens).toBeGreaterThan(0)
  })

  it('preserves recent tool results within protection window', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'recent question' },
      { role: 'assistant_tool_call', toolUseId: '1', toolName: 'read_file', input: {} },
      {
        role: 'tool_result',
        toolUseId: '1',
        toolName: 'read_file',
        content: 'x'.repeat(500),
        isError: false,
      },
      { role: 'assistant', content: 'here you go' },
    ]

    const { messages: result, freedTokens } = microCompact(messages, 3)
    const toolResult = result[3]!
    expect((toolResult as Extract<ChatMessage, { role: 'tool_result' }>).content).toBe('x'.repeat(500))
    expect(freedTokens).toBe(0)
  })

  it('skips small tool results', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'old question' },
      { role: 'assistant_tool_call', toolUseId: '1', toolName: 'read_file', input: {} },
      {
        role: 'tool_result',
        toolUseId: '1',
        toolName: 'read_file',
        content: 'tiny', // < 200 chars
        isError: false,
      },
      { role: 'assistant', content: 'done' },
      // 4 user turns to push the tool result out of protection
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]

    const { messages: result, freedTokens } = microCompact(messages, 3)
    const toolResult = result[3]!
    expect((toolResult as Extract<ChatMessage, { role: 'tool_result' }>).content).toBe('tiny')
    expect(freedTokens).toBe(0)
  })

  it('never mutates the original array', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'old' },
      { role: 'assistant_tool_call', toolUseId: '1', toolName: 'x', input: {} },
      { role: 'tool_result', toolUseId: '1', toolName: 'x', content: 'y'.repeat(300), isError: false },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]

    const original3 = messages[3]!
    microCompact(messages, 3)
    expect(messages[3]).toBe(original3) // original untouched
  })

  it('compacts old assistant tool call inputs', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'old question' },
      {
        role: 'assistant_tool_call',
        toolUseId: '1',
        toolName: 'write_file',
        input: { path: 'file.ts', content: 'x'.repeat(600) },
      },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]

    const { messages: result, freedTokens } = microCompact(messages, 3)
    const toolCall = result[2]!
    expect(toolCall.role).toBe('assistant_tool_call')
    expect((toolCall as Extract<ChatMessage, { role: 'assistant_tool_call' }>).input).toBe(COMPACTED_TOOL_CALL_INPUT)
    expect(freedTokens).toBeGreaterThan(0)
  })

  it('compacts old assistant progress messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'old question' },
      { role: 'assistant_progress', content: 'Working... '.repeat(40) },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'user', content: 'd' },
    ]

    const { messages: result, freedTokens } = microCompact(messages, 3)
    const progress = result[2]!
    expect(progress.role).toBe('assistant_progress')
    expect((progress as Extract<ChatMessage, { role: 'assistant_progress' }>).content).toBe(COMPACTED_PROGRESS_MESSAGE)
    expect(freedTokens).toBeGreaterThan(0)
  })
})

// ── Circuit breaker ─────────────────────────────────────────────────

describe('ContextTracker circuit breaker', () => {
  it('allows auto-compact by default', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    expect(tracker.canAutoCompact()).toBe(true)
    expect(tracker.consecutiveCompactFailures).toBe(0)
  })

  it('disables auto-compact after 3 consecutive failures', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordCompactFailure()
    expect(tracker.canAutoCompact()).toBe(true)
    tracker.recordCompactFailure()
    expect(tracker.canAutoCompact()).toBe(true)
    tracker.recordCompactFailure()
    expect(tracker.canAutoCompact()).toBe(false)
    expect(tracker.consecutiveCompactFailures).toBe(3)
  })

  it('resets failures on successful compaction', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordCompactFailure()
    tracker.recordCompactFailure()
    tracker.resetCompactFailures()
    expect(tracker.canAutoCompact()).toBe(true)
    expect(tracker.consecutiveCompactFailures).toBe(0)
  })

  it('resets failures via resetAfterCompaction()', () => {
    const tracker = new ContextTracker('claude-sonnet-4')
    tracker.recordCompactFailure()
    tracker.recordCompactFailure()
    tracker.resetAfterCompaction()
    expect(tracker.canAutoCompact()).toBe(true)
  })
})

// ── compactConversation ─────────────────────────────────────────────

describe('compactConversation', () => {
  it('returns null for conversations with fewer than 4 non-system messages', async () => {
    const mockModel = {
      async next() {
        return { type: 'assistant' as const, content: 'summary' }
      },
    }
    const result = await compactConversation({
      model: mockModel,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    })
    expect(result).toBeNull()
  })

  it('compacts a conversation and returns CompactionResult with correct counts', async () => {
    const mockModel = {
      async next() {
        return { type: 'assistant' as const, content: 'Summary of conversation.' }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Do task A' },
      { role: 'assistant', content: 'Done with task A.' },
      { role: 'user', content: 'Do task B' },
      { role: 'assistant', content: 'Done with task B.' },
      { role: 'user', content: 'Do task C' },
      { role: 'assistant', content: 'Done with task C.' },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).not.toBeNull()
    expect(result!.beforeCount).toBe(7)
    expect(result!.afterCount).toBeGreaterThanOrEqual(3) // system + summary-user + ack-assistant + possible recent
    expect(result!.freedTokens).toBeGreaterThanOrEqual(0)
    expect(result!.postCompactTokens).toBeGreaterThan(0)
    expect(result!.workingMemory).toContain('## Working Memory')
    // Summary should be present in the first user message after system
    const summaryMsg = result!.messages.find(
      m => m.role === 'user' && m.content.includes('Summary of conversation'),
    )
    expect(summaryMsg).toBeDefined()
  })

  it('strips <analysis> scratchpad from the summary', async () => {
    const mockModel = {
      async next() {
        return {
          type: 'assistant' as const,
          content: '<analysis>\nThinking about it...\n</analysis>\n\n## Goal\nDo something.',
        }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      { role: 'assistant', content: 'done 1' },
      { role: 'user', content: 'task 2' },
      { role: 'assistant', content: 'done 2' },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).not.toBeNull()
    const summaryMsg = result!.messages.find(
      m => m.role === 'user' && m.content.includes('## Goal'),
    )
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.content).not.toContain('<analysis>')
    expect(summaryMsg!.content).not.toContain('Thinking about it')
  })

  it('returns null when model returns empty content', async () => {
    const mockModel = {
      async next() {
        return { type: 'assistant' as const, content: '' }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).toBeNull()
  })

  it('returns null when model throws an error', async () => {
    const mockModel = {
      async next() {
        throw new Error('API failure')
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).toBeNull()
  })

  it('passes includeTools: false and maxOutputTokens to model', async () => {
    let receivedOptions: unknown = undefined
    const mockModel = {
      async next(_msgs: ChatMessage[], opts?: unknown) {
        receivedOptions = opts
        return { type: 'assistant' as const, content: 'summary' }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ]
    await compactConversation({ model: mockModel, messages })
    expect(receivedOptions).toEqual({
      maxOutputTokens: 20_000,
      includeTools: false,
    })
  })

  it('keeps the recent tail verbatim after the token-aware split', async () => {
    const mockModel = {
      async next() {
        return {
          type: 'assistant' as const,
          content: [
            '## Goal',
            'Do the work.',
            '',
            '## Instructions',
            'Preserve constraints.',
            '',
            '## Discoveries',
            'Important discovery.',
            '',
            '## Accomplished',
            'Initial tasks done.',
            '',
            '## Current State',
            'More work remains.',
            '',
            '## Relevant Files',
            'src/app.ts',
          ].join('\n'),
        }
      },
    }
    const recentUser = 'recent user message that must remain verbatim'
    const recentAssistant = 'recent assistant response that must remain verbatim'
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'older '.repeat(100) },
      { role: 'assistant', content: 'older response '.repeat(100) },
      { role: 'user', content: 'mid '.repeat(100) },
      { role: 'assistant', content: 'mid response '.repeat(100) },
      { role: 'user', content: recentUser },
      { role: 'assistant', content: recentAssistant },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).not.toBeNull()
    expect(result!.messages.some(m => m.role === 'user' && m.content === recentUser)).toBe(true)
    expect(result!.messages.some(m => m.role === 'assistant' && m.content === recentAssistant)).toBe(true)
  })

  it('wraps malformed summaries into the required structure', async () => {
    const mockModel = {
      async next() {
        return { type: 'assistant' as const, content: 'plain unstructured summary' }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task 1' },
      { role: 'assistant', content: 'done 1' },
      { role: 'user', content: 'task 2' },
      { role: 'assistant', content: 'done 2' },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).not.toBeNull()
    const summaryMsg = result!.messages.find(m => m.role === 'user' && m.content.includes('## Goal'))
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.content).toContain('## Relevant Files')
    expect(summaryMsg!.content).toContain('plain unstructured summary')
    expect(summaryMsg!.content).toContain('## Working Memory')
  })

  it('retries by shrinking older context when the compaction request is too long', async () => {
    let callCount = 0
    const mockModel = {
      async next() {
        callCount += 1
        if (callCount === 1) {
          throw new Error('prompt too long')
        }
        return {
          type: 'assistant' as const,
          content: [
            '## Goal',
            'Do the work.',
            '',
            '## Instructions',
            'Preserve constraints.',
            '',
            '## Discoveries',
            'Important discovery.',
            '',
            '## Accomplished',
            'Initial tasks done.',
            '',
            '## Current State',
            'More work remains.',
            '',
            '## Relevant Files',
            'src/app.ts',
          ].join('\n'),
        }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'older '.repeat(160) },
      { role: 'assistant', content: 'older response '.repeat(160) },
      { role: 'user', content: 'mid '.repeat(140) },
      { role: 'assistant', content: 'mid response '.repeat(140) },
      { role: 'user', content: 'recent user turn '.repeat(25) },
      { role: 'assistant', content: 'recent assistant turn '.repeat(25) },
    ]

    const result = await compactConversation({ model: mockModel, messages })
    expect(result).not.toBeNull()
    expect(callCount).toBe(2)
  })

  it('returns metadata about summarized and preserved recent messages', async () => {
    const mockModel = {
      async next() {
        return {
          type: 'assistant' as const,
          content: [
            '## Goal',
            'Do the work.',
            '',
            '## Instructions',
            'Preserve constraints.',
            '',
            '## Discoveries',
            'Important discovery in src/app.ts.',
            '',
            '## Accomplished',
            'Initial tasks done.',
            '',
            '## Current State',
            'Continue editing src/app.ts and verify tests.',
            '',
            '## Relevant Files',
            'src/app.ts',
          ].join('\n'),
        }
      },
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'older '.repeat(100) },
      { role: 'assistant', content: 'older response '.repeat(100) },
      { role: 'user', content: 'mid '.repeat(100) },
      { role: 'assistant', content: 'mid response '.repeat(100) },
      { role: 'user', content: 'recent user message' },
      { role: 'assistant', content: 'recent assistant response' },
    ]
    const result = await compactConversation({ model: mockModel, messages })
    expect(result).not.toBeNull()
    expect(result!.summarizedMessageCount).toBeGreaterThan(0)
    expect(result!.preservedRecentMessageCount).toBeGreaterThan(0)
    expect(result!.workingMemory).toContain('src/app.ts')
    expect(result!.workingMemory).toContain('Continue editing src/app.ts')
  })

  it('improves context efficiency over the baseline by keeping a recent tail with lower total tokens than raw history', () => {
    const summary = [
      '## Goal',
      'Do the work.',
      '',
      '## Instructions',
      'Preserve constraints.',
      '',
      '## Discoveries',
      'Important discovery.',
      '',
      '## Accomplished',
      'Initial tasks done.',
      '',
      '## Current State',
      'More work remains.',
      '',
      '## Relevant Files',
      'src/app.ts',
    ].join('\n')
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'older '.repeat(160) },
      { role: 'assistant', content: 'older response '.repeat(160) },
      { role: 'user', content: 'mid '.repeat(140) },
      { role: 'assistant', content: 'mid response '.repeat(140) },
      { role: 'user', content: 'recent user turn '.repeat(25) },
      { role: 'assistant', content: 'recent assistant turn '.repeat(25) },
    ]

    const baseline = compactConversationBaseline({ messages, summary })
    expect(baseline).not.toBeNull()
    const improvedMessages = [
      { role: 'system', content: 'sys' },
      {
        role: 'user' as const,
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
        role: 'assistant' as const,
        content: 'I understand the context from the summary. I\'ll continue from where we left off without repeating completed work.',
      },
      { role: 'user', content: 'recent user turn '.repeat(25) },
      { role: 'assistant', content: 'recent assistant turn '.repeat(25) },
    ]

    expect(estimateMessagesTokenCount(improvedMessages)).toBeLessThan(estimateMessagesTokenCount(messages))
    expect(estimateMessagesTokenCount(improvedMessages)).toBeGreaterThan(estimateMessagesTokenCount(baseline!.messages))
  })
})
