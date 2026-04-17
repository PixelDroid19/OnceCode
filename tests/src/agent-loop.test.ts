import { describe, expect, it, vi } from 'vitest'
import { runAgentTurn } from '../../src/agent-loop.js'
import { ToolRegistry } from '../../src/tool.js'
import { z } from 'zod'

describe('agent-loop', () => {
  it('returns assistant final messages', async () => {
    const messages = await runAgentTurn({
      model: {
        next: vi.fn(async () => ({ type: 'assistant', content: '<final>done', kind: 'final' })),
      },
      tools: new ToolRegistry([]),
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
    })

    expect(messages.at(-1)).toEqual({ role: 'assistant', content: '<final>done' })
  })

  it('executes tool calls and appends tool result messages', async () => {
    const toolRun = vi.fn(async () => ({ ok: true, output: 'tool output' }))
    const registry = new ToolRegistry([
      {
        name: 'demo',
        description: 'demo',
        inputSchema: {},
        schema: z.object({ value: z.string() }),
        run: toolRun,
      },
    ])
    const model = {
      next: vi
        .fn()
        .mockResolvedValueOnce({
          type: 'tool_calls',
          calls: [{ id: '1', toolName: 'demo', input: { value: 'x' } }],
        })
        .mockResolvedValueOnce({ type: 'assistant', content: 'done' }),
    }

    const messages = await runAgentTurn({
      model,
      tools: registry,
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
    })

    expect(toolRun).toHaveBeenCalledOnce()
    expect(messages.some((message) => message.role === 'tool_result')).toBe(true)
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'done' })
  })

  it('stops the turn when ask_user awaits user input', async () => {
    const registry = new ToolRegistry([
      {
        name: 'ask_user',
        description: 'ask',
        inputSchema: {},
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'Need answer?', awaitUser: true })),
      },
    ])
    const model = {
      next: vi.fn(async () => ({
        type: 'tool_calls',
        calls: [{ id: '1', toolName: 'ask_user', input: {} }],
      })),
    }

    const messages = await runAgentTurn({
      model,
      tools: registry,
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
    })

    expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'Need answer?' })
  })

  it('adds fallback messages after repeated empty responses', async () => {
    const model = {
      next: vi.fn(async () => ({ type: 'assistant', content: '' })),
    }
    const messages = await runAgentTurn({
      model,
      tools: new ToolRegistry([]),
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
    })

    expect(messages.at(-1)?.role).toBe('assistant')
    expect((messages.at(-1) as { content: string }).content).toContain('模型返回空响应')
  })
})
