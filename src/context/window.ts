import type { ChatMessage, TokenUsage } from '@/types.js'
import {
  CHARS_PER_TOKEN,
  COMPACTION_BUFFER_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
} from '@/constants.js'

// ── Max output token configuration ──────────────────────────────────

type ModelMaxOutputTokens = {
  default: number
  upperLimit: number
}

type ModelMaxOutputTokenRule = {
  patterns: string[]
  limits: ModelMaxOutputTokens
}

const UNKNOWN_MODEL_MAX_OUTPUT_TOKENS: ModelMaxOutputTokens = {
  default: 32_000,
  upperLimit: 64_000,
}

const MODEL_MAX_OUTPUT_TOKEN_RULES: ModelMaxOutputTokenRule[] = [
  {
    patterns: ['claude-opus-4-6', 'claude opus 4.6', 'opus-4-6'],
    limits: { default: 128_000, upperLimit: 128_000 },
  },
  {
    patterns: ['claude-sonnet-4-6', 'claude sonnet 4.6', 'sonnet-4-6'],
    limits: { default: 64_000, upperLimit: 64_000 },
  },
  {
    patterns: ['claude-haiku-4-5', 'claude haiku 4.5', 'haiku-4-5'],
    limits: { default: 64_000, upperLimit: 64_000 },
  },
  {
    patterns: ['claude-opus-4-1', 'claude opus 4.1', 'opus-4-1', 'claude-opus-4', 'claude opus 4', 'opus-4'],
    limits: { default: 32_000, upperLimit: 32_000 },
  },
  {
    patterns: ['claude-sonnet-4', 'claude sonnet 4', 'sonnet-4'],
    limits: { default: 64_000, upperLimit: 64_000 },
  },
  {
    patterns: ['claude-3-7-sonnet', 'claude 3.7 sonnet', '3-7-sonnet'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['claude-3-5-sonnet', 'claude 3.5 sonnet', '3-5-sonnet', 'claude-3-sonnet'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['claude-3-5-haiku', 'claude 3.5 haiku', '3-5-haiku'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['claude-3-opus', 'claude 3 opus'],
    limits: { default: 4_096, upperLimit: 4_096 },
  },
  {
    patterns: ['claude-3-haiku', 'claude 3 haiku'],
    limits: { default: 4_096, upperLimit: 4_096 },
  },
  {
    patterns: ['gpt-5-codex', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5'],
    limits: { default: 128_000, upperLimit: 128_000 },
  },
  {
    patterns: ['o4-mini', 'o3', 'o1-pro', 'o1'],
    limits: { default: 100_000, upperLimit: 100_000 },
  },
  {
    patterns: ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1'],
    limits: { default: 32_768, upperLimit: 32_768 },
  },
  {
    patterns: ['gpt-4o-mini', 'gpt-4o'],
    limits: { default: 16_384, upperLimit: 16_384 },
  },
  {
    patterns: ['gpt-4'],
    limits: { default: 8_192, upperLimit: 8_192 },
  },
  {
    patterns: ['gemini-2.5-pro', 'gemini 2.5 pro', 'gemini-2.5-flash-lite', 'gemini 2.5 flash-lite', 'gemini-2.5-flash', 'gemini 2.5 flash'],
    limits: { default: 65_536, upperLimit: 65_536 },
  },
  {
    patterns: ['deepseek-reasoner'],
    limits: { default: 32_000, upperLimit: 64_000 },
  },
  {
    patterns: ['deepseek-chat'],
    limits: { default: 4_000, upperLimit: 8_000 },
  },
]

/** Looks up the max output token limits for a given model name. */
export function getModelMaxOutputTokens(model: string): ModelMaxOutputTokens {
  const normalized = model.trim().toLowerCase()
  for (const rule of MODEL_MAX_OUTPUT_TOKEN_RULES) {
    if (rule.patterns.some(pattern => normalized.includes(pattern))) {
      return rule.limits
    }
  }

  return UNKNOWN_MODEL_MAX_OUTPUT_TOKENS
}

/** Resolves the effective max output tokens, honouring user overrides up to the model upper limit. */
export function resolveMaxOutputTokens(
  model: string,
  configuredMaxOutputTokens?: number,
): number {
  const limits = getModelMaxOutputTokens(model)
  if (
    configuredMaxOutputTokens !== undefined &&
    Number.isFinite(configuredMaxOutputTokens) &&
    configuredMaxOutputTokens > 0
  ) {
    return Math.min(Math.floor(configuredMaxOutputTokens), limits.upperLimit)
  }

  return limits.default
}

// ── Context window configuration ────────────────────────────────────

type ContextWindowRule = {
  patterns: string[]
  contextWindow: number
}

/**
 * Per-model context window sizes (total tokens the model can accept).
 * Rules are matched first-match in order, so more specific patterns come first.
 */
const CONTEXT_WINDOW_RULES: ContextWindowRule[] = [
  // Anthropic family — all 200K
  { patterns: ['claude-opus-4-6', 'opus-4-6'], contextWindow: 200_000 },
  { patterns: ['claude-sonnet-4-6', 'sonnet-4-6'], contextWindow: 200_000 },
  { patterns: ['claude-haiku-4-5', 'haiku-4-5'], contextWindow: 200_000 },
  { patterns: ['claude-opus-4-1', 'opus-4-1', 'claude-opus-4', 'opus-4'], contextWindow: 200_000 },
  { patterns: ['claude-sonnet-4', 'sonnet-4'], contextWindow: 200_000 },
  { patterns: ['claude-3-7-sonnet', '3-7-sonnet'], contextWindow: 200_000 },
  { patterns: ['claude-3-5-sonnet', '3-5-sonnet', 'claude-3-sonnet'], contextWindow: 200_000 },
  { patterns: ['claude-3-5-haiku', '3-5-haiku'], contextWindow: 200_000 },
  { patterns: ['claude-3-opus'], contextWindow: 200_000 },
  { patterns: ['claude-3-haiku'], contextWindow: 200_000 },
  { patterns: ['claude-2'], contextWindow: 100_000 },
  // GPT-5 family
  { patterns: ['gpt-5-codex', 'gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5'], contextWindow: 128_000 },
  // o-series
  { patterns: ['o4-mini', 'o3', 'o1-pro', 'o1'], contextWindow: 200_000 },
  // GPT-4.x
  { patterns: ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.1'], contextWindow: 1_047_576 },
  { patterns: ['gpt-4o-mini', 'gpt-4o'], contextWindow: 128_000 },
  { patterns: ['gpt-4-turbo'], contextWindow: 128_000 },
  { patterns: ['gpt-4'], contextWindow: 8_192 },
  // Gemini
  { patterns: ['gemini-2.5-pro', 'gemini-2.5-flash'], contextWindow: 1_000_000 },
  { patterns: ['gemini-2.0'], contextWindow: 1_000_000 },
  // DeepSeek
  { patterns: ['deepseek-reasoner', 'deepseek-chat', 'deepseek-coder'], contextWindow: 128_000 },
  // Qwen
  { patterns: ['qwen3', 'qwen-coder'], contextWindow: 256_000 },
]

/** Returns the context window size (total tokens) for a model. Falls back to DEFAULT_CONTEXT_WINDOW. */
export function getContextWindowSize(model: string): number {
  const normalized = model.trim().toLowerCase()
  for (const rule of CONTEXT_WINDOW_RULES) {
    if (rule.patterns.some(pattern => normalized.includes(pattern))) {
      return rule.contextWindow
    }
  }
  return DEFAULT_CONTEXT_WINDOW
}

// ── Token estimation ────────────────────────────────────────────────

/** Rough token count estimation based on character length (chars / 4). */
export function estimateTokenCount(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

/** Estimates the total token count for a message array without an API call. */
export function estimateMessagesTokenCount(messages: ChatMessage[]): number {
  let total = 0
  for (const msg of messages) {
    if ('content' in msg && typeof msg.content === 'string') {
      total += estimateTokenCount(msg.content)
    }
    if (msg.role === 'assistant_tool_call') {
      total += estimateTokenCount(JSON.stringify(msg.input))
    }
  }
  // Rough overhead per message (role labels, separators)
  total += messages.length * 4
  return total
}

// ── Overflow detection ──────────────────────────────────────────────

/**
 * The effective context budget — the max tokens available for input content
 * before we must compact. Leaves room for output and a safety buffer.
 */
export function getEffectiveContextBudget(
  model: string,
  configuredMaxOutputTokens?: number,
): number {
  const contextWindow = getContextWindowSize(model)
  const maxOutput = resolveMaxOutputTokens(model, configuredMaxOutputTokens)
  const reserved = Math.min(COMPACTION_BUFFER_TOKENS, maxOutput)
  return contextWindow - maxOutput - reserved
}

/**
 * Returns true when the last API-reported token count exceeds the
 * effective context budget, indicating that compaction should run.
 */
export function shouldCompact(
  model: string,
  lastInputTokens: number,
  configuredMaxOutputTokens?: number,
): boolean {
  if (lastInputTokens <= 0) return false
  return lastInputTokens >= getEffectiveContextBudget(model, configuredMaxOutputTokens)
}

/**
 * Predicts whether the next request should compact by adding the estimated
 * token cost of messages not reflected in the last provider-reported usage.
 */
export function shouldCompactNextTurn(args: {
  model: string
  lastInputTokens: number
  messages: ChatMessage[]
  configuredMaxOutputTokens?: number
  alreadyCountedMessages?: ChatMessage[]
}): boolean {
  const {
    model,
    lastInputTokens,
    messages,
    configuredMaxOutputTokens,
    alreadyCountedMessages = [],
  } = args

  const delta = Math.max(
    0,
    estimateMessagesTokenCount(messages) - estimateMessagesTokenCount(alreadyCountedMessages),
  )

  return lastInputTokens + delta >= getEffectiveContextBudget(model, configuredMaxOutputTokens)
}

/**
 * Total tokens consumed from a single-request usage report.
 * Includes input, output, and cache tokens.
 */
export function getTotalTokensFromUsage(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  )
}

/** Context usage as a fraction (0–1) of the context window. */
export function getContextUsageFraction(
  model: string,
  lastInputTokens: number,
): number {
  const contextWindow = getContextWindowSize(model)
  if (contextWindow <= 0) return 0
  return Math.min(1, Math.max(0, lastInputTokens / contextWindow))
}
