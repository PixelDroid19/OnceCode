import {
  CHARS_PER_TOKEN,
  COMPACTION_BUFFER_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
} from '@/constants.js'
import {
  createUnknownModel,
  getModelInfo,
  type ModelInfo,
} from '@/provider/catalog.js'
import type { ChatMessage, TokenUsage } from '@/types.js'

type ModelMaxOutputTokens = {
  default: number
  upperLimit: number
}

function resolveModel(input: string | ModelInfo): ModelInfo {
  if (typeof input !== 'string') {
    return input
  }

  return getModelInfo(input) ?? createUnknownModel('anthropic', input)
}

export function getModelMaxOutputTokens(input: string | ModelInfo): ModelMaxOutputTokens {
  const model = resolveModel(input)
  return {
    default: model.defaultOutput,
    upperLimit: model.limits.output,
  }
}

export function resolveMaxOutputTokens(
  input: string | ModelInfo,
  configuredMaxOutputTokens?: number,
): number {
  const limits = getModelMaxOutputTokens(input)
  if (
    configuredMaxOutputTokens !== undefined &&
    Number.isFinite(configuredMaxOutputTokens) &&
    configuredMaxOutputTokens > 0
  ) {
    return Math.min(Math.floor(configuredMaxOutputTokens), limits.upperLimit)
  }

  return limits.default
}

export function getContextWindowSize(input: string | ModelInfo): number {
  const model = resolveModel(input)
  return model.limits.context || DEFAULT_CONTEXT_WINDOW
}

export function estimateTokenCount(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN))
}

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
  total += messages.length * 4
  return total
}

export function getEffectiveContextBudget(
  input: string | ModelInfo,
  configuredMaxOutputTokens?: number,
): number {
  const contextWindow = getContextWindowSize(input)
  const maxOutput = resolveMaxOutputTokens(input, configuredMaxOutputTokens)
  const reserved = Math.min(COMPACTION_BUFFER_TOKENS, maxOutput)
  return contextWindow - maxOutput - reserved
}

export function shouldCompact(
  input: string | ModelInfo,
  lastInputTokens: number,
  configuredMaxOutputTokens?: number,
): boolean {
  if (lastInputTokens <= 0) return false
  return lastInputTokens >= getEffectiveContextBudget(input, configuredMaxOutputTokens)
}

export function shouldCompactNextTurn(args: {
  model: string | ModelInfo
  lastInputTokens: number
  messages: ChatMessage[]
  configuredMaxOutputTokens?: number
  alreadyCountedMessages?: ChatMessage[]
}): boolean {
  const delta = Math.max(
    0,
    estimateMessagesTokenCount(args.messages) - estimateMessagesTokenCount(args.alreadyCountedMessages ?? []),
  )

  return args.lastInputTokens + delta >= getEffectiveContextBudget(args.model, args.configuredMaxOutputTokens)
}

export function getTotalTokensFromUsage(usage: TokenUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationInputTokens +
    usage.cacheReadInputTokens
  )
}

export function getContextUsageFraction(
  input: string | ModelInfo,
  lastInputTokens: number,
): number {
  const contextWindow = getContextWindowSize(input)
  if (contextWindow <= 0) return 0
  return Math.min(1, Math.max(0, lastInputTokens / contextWindow))
}
