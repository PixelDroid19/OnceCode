import { compactConversation, compactConversationBaseline } from '@/context/compaction.js'
import { estimateMessagesTokenCount } from '@/context/window.js'
import type { ChatMessage, ModelRequestOptions } from '@/types.js'

type BenchCase = {
  name: string
  messages: ChatMessage[]
}

const STRUCTURED_SUMMARY = [
  '## Goal',
  'Finish the requested engineering work.',
  '',
  '## Instructions',
  'Preserve constraints, avoid repeating completed work, and continue from the latest state.',
  '',
  '## Discoveries',
  'The session includes tool-heavy investigation, code edits, and recent user guidance.',
  '',
  '## Accomplished',
  'Older work has already been completed and captured in summary form.',
  '',
  '## Current State',
  'Resume from the most recent preserved context and continue the remaining steps.',
  '',
  '## Relevant Files',
  'src/context/compaction.ts, src/context/tracker.ts, src/tty/app.ts',
].join('\n')

const mockModel = {
  async next(_messages: ChatMessage[], _options?: ModelRequestOptions) {
    return {
      type: 'assistant' as const,
      content: STRUCTURED_SUMMARY,
    }
  },
}

function buildSession(args: {
  turns: number
  toolPayloadSize: number
  toolResultSize: number
  progressSize: number
  recentTurns: number
}): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: 'system prompt' }]

  for (let i = 0; i < args.turns; i++) {
    const isRecent = i >= args.turns - args.recentTurns
    messages.push({ role: 'user', content: `user turn ${i} ${'question '.repeat(isRecent ? 10 : 40)}` })
    messages.push({ role: 'assistant_progress', content: `progress ${i}: ${'working '.repeat(Math.max(1, Math.floor(args.progressSize / 8)))}` })
    messages.push({
      role: 'assistant_tool_call',
      toolUseId: `tool-${i}`,
      toolName: 'write_file',
      input: {
        path: `src/file-${i}.ts`,
        content: 'x'.repeat(args.toolPayloadSize),
      },
    })
    messages.push({
      role: 'tool_result',
      toolUseId: `tool-${i}`,
      toolName: 'write_file',
      content: `result ${i}: ${'y'.repeat(args.toolResultSize)}`,
      isError: false,
    })
    messages.push({ role: 'assistant', content: `assistant turn ${i} ${'done '.repeat(isRecent ? 8 : 30)}` })
  }

  return messages
}

function hasRecentTailPreserved(messages: ChatMessage[], original: ChatMessage[]): boolean {
  const recentOriginal = original.slice(-2)
  return recentOriginal.every(target => messages.some(message => JSON.stringify(message) === JSON.stringify(target)))
}

async function runCase(testCase: BenchCase): Promise<void> {
  const rawTokens = estimateMessagesTokenCount(testCase.messages)
  const baseline = compactConversationBaseline({
    messages: testCase.messages,
    summary: STRUCTURED_SUMMARY,
  })
  const improved = await compactConversation({
    model: mockModel,
    messages: testCase.messages,
  })

  if (!baseline || !improved) {
    throw new Error(`Benchmark case failed: ${testCase.name}`)
  }

  const baselineTokens = estimateMessagesTokenCount(baseline.messages)
  const improvedTokens = estimateMessagesTokenCount(improved.messages)
  const baselineReduction = (((rawTokens - baselineTokens) / rawTokens) * 100).toFixed(1)
  const improvedReduction = (((rawTokens - improvedTokens) / rawTokens) * 100).toFixed(1)

  console.log(`\n[${testCase.name}]`)
  console.log(`raw tokens:      ${rawTokens}`)
  console.log(`baseline tokens: ${baselineTokens} (${baselineReduction}% reduction)`)
  console.log(`improved tokens: ${improvedTokens} (${improvedReduction}% reduction)`)
  console.log(`baseline freed:  ${baseline.freedTokens}`)
  console.log(`improved freed:  ${improved.freedTokens}`)
  console.log(`recent tail kept: ${hasRecentTailPreserved(improved.messages, testCase.messages) ? 'yes' : 'no'}`)
}

async function main(): Promise<void> {
  const cases: BenchCase[] = [
    {
      name: 'tool-heavy session',
      messages: buildSession({
        turns: 8,
        toolPayloadSize: 1600,
        toolResultSize: 3200,
        progressSize: 480,
        recentTurns: 2,
      }),
    },
    {
      name: 'mixed coding session',
      messages: buildSession({
        turns: 6,
        toolPayloadSize: 900,
        toolResultSize: 1800,
        progressSize: 280,
        recentTurns: 2,
      }),
    },
  ]

  console.log('Context Compaction Benchmark')
  console.log('Comparing raw history vs baseline one-shot vs improved compaction')

  for (const testCase of cases) {
    await runCase(testCase)
  }
}

void main()
