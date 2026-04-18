import type { ChatMessage, TokenUsage } from '@/types.js'
import {
  CONTEXT_ERROR_THRESHOLD,
  CONTEXT_WARNING_THRESHOLD,
  MAX_CONSECUTIVE_COMPACT_FAILURES,
} from '@/constants.js'
import {
  getContextUsageFraction,
  getContextWindowSize,
  getEffectiveContextBudget,
  resolveMaxOutputTokens,
  shouldCompact,
  shouldCompactNextTurn,
} from './window.js'

/** Warning level for TUI context usage display. */
export type ContextWarningLevel = 'normal' | 'warning' | 'error'

/** Read-only snapshot of context tracking state for display purposes. */
export interface ContextSnapshot {
  model: string
  contextWindow: number
  maxOutputTokens: number
  effectiveBudget: number
  lastInputTokens: number
  projectedPostCompactTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreation: number
  totalCacheRead: number
  requestCount: number
  usageFraction: number
  usagePercent: number
  warningLevel: ContextWarningLevel
  shouldCompact: boolean
}

/**
 * Tracks token usage across a session, detects context overflow,
 * and provides data for the TUI context badge.
 *
 * The tracker uses the **last API-reported input token count** as
 * the proxy for current context size, because that reflects the
 * actual token count the provider computed for the most recent
 * request (including system prompt, tools, and full message history).
 */
export class ContextTracker {
  #model: string
  #configuredMaxOutputTokens: number | undefined
  #lastInputTokens = 0
  #totalInputTokens = 0
  #totalOutputTokens = 0
  #totalCacheCreation = 0
  #totalCacheRead = 0
  #requestCount = 0
  #consecutiveCompactFailures = 0
  #projectedPostCompactTokens = 0

  constructor(model: string, configuredMaxOutputTokens?: number) {
    this.#model = model
    this.#configuredMaxOutputTokens = configuredMaxOutputTokens
  }

  /** Updates the model (e.g. after `/model` command). */
  setModel(model: string): void {
    this.#model = model
  }

  /** Records a single API response's usage data. */
  recordUsage(usage: TokenUsage): void {
    this.#lastInputTokens = usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens
    this.#projectedPostCompactTokens = 0
    this.#totalInputTokens += usage.inputTokens
    this.#totalOutputTokens += usage.outputTokens
    this.#totalCacheCreation += usage.cacheCreationInputTokens
    this.#totalCacheRead += usage.cacheReadInputTokens
    this.#requestCount += 1
  }

  /** Seeds tracker state from the projected post-compact context. */
  resetAfterCompaction(projectedPostCompactTokens?: number): void {
    const safeProjected = Math.max(0, Math.floor(projectedPostCompactTokens ?? 0))
    this.#lastInputTokens = safeProjected
    this.#projectedPostCompactTokens = safeProjected
    this.#consecutiveCompactFailures = 0
    // Keep cumulative totals — they represent session-lifetime usage.
    // Seed the "last" pointer until the next API response replaces it.
  }

  /** Records a compaction failure for the circuit breaker. */
  recordCompactFailure(): void {
    this.#consecutiveCompactFailures += 1
  }

  /** Resets the compaction failure counter (call after a successful compaction). */
  resetCompactFailures(): void {
    this.#consecutiveCompactFailures = 0
  }

  /**
   * Whether auto-compaction is allowed based on the circuit breaker.
   * Returns `false` after `MAX_CONSECUTIVE_COMPACT_FAILURES` consecutive failures.
   */
  canAutoCompact(): boolean {
    return this.#consecutiveCompactFailures < MAX_CONSECUTIVE_COMPACT_FAILURES
  }

  /** Current number of consecutive compaction failures. */
  get consecutiveCompactFailures(): number {
    return this.#consecutiveCompactFailures
  }

  /** Whether the context is overflowing and compaction should trigger. */
  shouldCompact(): boolean {
    return shouldCompact(this.#model, this.#lastInputTokens, this.#configuredMaxOutputTokens)
  }

  /**
   * Predicts whether the next request should compact after adding any pending
   * messages that were not included in the last provider-reported usage.
   */
  shouldCompactNextTurn(
    messages: ChatMessage[],
    alreadyCountedMessages?: ChatMessage[],
  ): boolean {
    return shouldCompactNextTurn({
      model: this.#model,
      lastInputTokens: this.#lastInputTokens,
      configuredMaxOutputTokens: this.#configuredMaxOutputTokens,
      messages,
      alreadyCountedMessages,
    })
  }

  /** Context usage as a 0–1 fraction. */
  get usageFraction(): number {
    return getContextUsageFraction(this.#model, this.#lastInputTokens)
  }

  /** Context usage as 0–100 integer. */
  get usagePercent(): number {
    return Math.round(this.usageFraction * 100)
  }

  /** Warning level for TUI display. */
  get warningLevel(): ContextWarningLevel {
    const fraction = this.usageFraction
    if (fraction >= CONTEXT_ERROR_THRESHOLD) return 'error'
    if (fraction >= CONTEXT_WARNING_THRESHOLD) return 'warning'
    return 'normal'
  }

  /** Last API-reported input tokens (proxy for context size). */
  get lastInputTokens(): number {
    return this.#lastInputTokens
  }

  /** Estimated context size immediately after compaction, before the next API response. */
  get projectedPostCompactTokens(): number {
    return this.#projectedPostCompactTokens
  }

  /** Total API requests made in this session. */
  get requestCount(): number {
    return this.#requestCount
  }

  /** Returns a read-only snapshot of all tracking state. */
  snapshot(): ContextSnapshot {
    const contextWindow = getContextWindowSize(this.#model)
    const maxOutputTokens = resolveMaxOutputTokens(this.#model, this.#configuredMaxOutputTokens)
    return {
      model: this.#model,
      contextWindow,
      maxOutputTokens,
      effectiveBudget: getEffectiveContextBudget(this.#model, this.#configuredMaxOutputTokens),
      lastInputTokens: this.#lastInputTokens,
      projectedPostCompactTokens: this.#projectedPostCompactTokens,
      totalInputTokens: this.#totalInputTokens,
      totalOutputTokens: this.#totalOutputTokens,
      totalCacheCreation: this.#totalCacheCreation,
      totalCacheRead: this.#totalCacheRead,
      requestCount: this.#requestCount,
      usageFraction: this.usageFraction,
      usagePercent: this.usagePercent,
      warningLevel: this.warningLevel,
      shouldCompact: this.shouldCompact(),
    }
  }

  /** Formats a human-readable summary string (used by /context command). */
  formatSummary(): string {
    const snap = this.snapshot()
    const pct = snap.usagePercent
    const ctx = formatTokenCount(snap.contextWindow)
    const used = formatTokenCount(snap.lastInputTokens)
    const budget = formatTokenCount(snap.effectiveBudget)
    const maxOut = formatTokenCount(snap.maxOutputTokens)
    const totalIn = formatTokenCount(snap.totalInputTokens)
    const totalOut = formatTokenCount(snap.totalOutputTokens)
    const cacheCreate = formatTokenCount(snap.totalCacheCreation)
    const cacheRead = formatTokenCount(snap.totalCacheRead)

    return [
      `Model: ${snap.model}`,
      `Context window: ${ctx}`,
      `Max output tokens: ${maxOut}`,
      `Effective budget (auto-compact threshold): ${budget}`,
      '',
      `Current context usage: ${used} / ${ctx} (${pct}%)`,
      `API requests this session: ${snap.requestCount}`,
      '',
      `Session totals:`,
      `  Input tokens:  ${totalIn}`,
      `  Output tokens: ${totalOut}`,
      `  Cache creation: ${cacheCreate}`,
      `  Cache read:     ${cacheRead}`,
    ].join('\n')
  }
}

/** Formats a token count for human display (e.g. 145000 → "145K"). */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`
  }
  if (count >= 1_000) {
    const k = count / 1_000
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`
  }
  return String(count)
}
