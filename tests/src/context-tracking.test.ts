import { describe, expect, it } from 'vitest'
import {
  getContextWindowSize,
  getEffectiveContextBudget,
  estimateTokenCount,
  estimateMessagesTokenCount,
  shouldCompact,
  getContextUsageFraction,
  resolveMaxOutputTokens,
} from '../../src/utils/context.js'
import { ContextTracker, formatTokenCount } from '../../src/context-tracker.js'
import type { ChatMessage, TokenUsage } from '../../src/types.js'
import { microCompact } from '../../src/compaction.js'
import { CLEARED_TOOL_OUTPUT } from '../../src/constants.js'

// ── Context window size rules ──────────────────────────────────────

describe('getContextWindowSize', () => {
  it('returns 200K for Claude models', () => {
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
    tracker.recordUsage(makeUsage(100_000))
    expect(tracker.usagePercent).toBe(50)
    expect(tracker.warningLevel).toBe('normal')
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
    tracker.resetAfterCompaction()
    expect(tracker.shouldCompact()).toBe(false)
    expect(tracker.usagePercent).toBe(0)
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
})
