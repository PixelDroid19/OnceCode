import {
  CONTEXT_ERROR_THRESHOLD,
  CONTEXT_WARNING_THRESHOLD,
  MAX_CONSECUTIVE_COMPACT_FAILURES,
} from '@/constants.js'
import type { ChatMessage, TokenUsage } from '@/types.js'
import type { ModelInfo } from '@/provider/catalog.js'
import {
  formatModelRef,
} from '@/provider/catalog.js'
import {
  getContextUsageFraction,
  getContextWindowSize,
  getEffectiveContextBudget,
  resolveMaxOutputTokens,
  shouldCompact,
  shouldCompactNextTurn,
} from './window.js'

export type ContextWarningLevel = 'normal' | 'warning' | 'error'

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

function resolveModel(input: string | ModelInfo): ModelInfo | string {
  if (typeof input !== 'string') {
    return input
  }

  return input
}

function formatModel(input: string | ModelInfo): string {
  if (typeof input === 'string') return input
  return formatModelRef(input)
}

export class ContextTracker {
  #model: string | ModelInfo
  #configuredMaxOutputTokens: number | undefined
  #lastInputTokens = 0
  #totalInputTokens = 0
  #totalOutputTokens = 0
  #totalCacheCreation = 0
  #totalCacheRead = 0
  #requestCount = 0
  #consecutiveCompactFailures = 0
  #projectedPostCompactTokens = 0

  constructor(model: string | ModelInfo, configuredMaxOutputTokens?: number) {
    this.#model = resolveModel(model)
    this.#configuredMaxOutputTokens = configuredMaxOutputTokens
  }

  setModel(model: string | ModelInfo, configuredMaxOutputTokens?: number): void {
    this.#model = resolveModel(model)
    this.#configuredMaxOutputTokens = configuredMaxOutputTokens
  }

  recordUsage(usage: TokenUsage): void {
    this.#lastInputTokens = usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens
    this.#projectedPostCompactTokens = 0
    this.#totalInputTokens += usage.inputTokens
    this.#totalOutputTokens += usage.outputTokens
    this.#totalCacheCreation += usage.cacheCreationInputTokens
    this.#totalCacheRead += usage.cacheReadInputTokens
    this.#requestCount += 1
  }

  resetAfterCompaction(projectedPostCompactTokens?: number): void {
    const safe = Math.max(0, Math.floor(projectedPostCompactTokens ?? 0))
    this.#lastInputTokens = safe
    this.#projectedPostCompactTokens = safe
    this.#consecutiveCompactFailures = 0
  }

  recordCompactFailure(): void {
    this.#consecutiveCompactFailures += 1
  }

  resetCompactFailures(): void {
    this.#consecutiveCompactFailures = 0
  }

  canAutoCompact(): boolean {
    return this.#consecutiveCompactFailures < MAX_CONSECUTIVE_COMPACT_FAILURES
  }

  get consecutiveCompactFailures(): number {
    return this.#consecutiveCompactFailures
  }

  shouldCompact(): boolean {
    return shouldCompact(this.#model, this.#lastInputTokens, this.#configuredMaxOutputTokens)
  }

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

  get usageFraction(): number {
    return getContextUsageFraction(this.#model, this.#lastInputTokens)
  }

  get usagePercent(): number {
    return Math.round(this.usageFraction * 100)
  }

  get warningLevel(): ContextWarningLevel {
    const fraction = this.usageFraction
    if (fraction >= CONTEXT_ERROR_THRESHOLD) return 'error'
    if (fraction >= CONTEXT_WARNING_THRESHOLD) return 'warning'
    return 'normal'
  }

  get lastInputTokens(): number {
    return this.#lastInputTokens
  }

  get projectedPostCompactTokens(): number {
    return this.#projectedPostCompactTokens
  }

  get requestCount(): number {
    return this.#requestCount
  }

  snapshot(): ContextSnapshot {
    const contextWindow = getContextWindowSize(this.#model)
    const maxOutputTokens = resolveMaxOutputTokens(this.#model, this.#configuredMaxOutputTokens)
    return {
      model: formatModel(this.#model),
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
