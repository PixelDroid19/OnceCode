import { describe, expect, it, vi } from 'vitest'
import { runAgentTurn } from '@/agent/loop.js'
import { ToolRegistry } from '@/tools/framework.js'
import type { ModelAdapter, AgentStep } from '@/types.js'
import { z } from 'zod'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function makeReadOnlyTool(name: string, delayMs: number) {
  return {
    name,
    description: 'test',
    inputSchema: {},
    schema: z.object({}).passthrough(),
    run: vi.fn(async () => {
      await sleep(delayMs)
      return { ok: true, output: `${name} result` }
    }),
  }
}

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
    expect((messages.at(-1) as { content: string }).content).toContain('The model returned an empty response')
  })

  it('multiple read-only tool calls execute concurrently', async () => {
    const delayMs = 50
    const tools = [
      makeReadOnlyTool('read_file', delayMs),
      makeReadOnlyTool('grep_files', delayMs),
      makeReadOnlyTool('list_files', delayMs),
    ]
    const registry = new ToolRegistry(tools)

    const model: ModelAdapter = {
      next: vi
        .fn()
        .mockResolvedValueOnce({
          type: 'tool_calls',
          calls: [
            { id: '1', toolName: 'read_file', input: {} },
            { id: '2', toolName: 'grep_files', input: {} },
            { id: '3', toolName: 'list_files', input: {} },
          ],
        } satisfies AgentStep)
        .mockResolvedValueOnce({
          type: 'assistant',
          content: 'done',
        } satisfies AgentStep),
    }

    const start = Date.now()
    const messages = await runAgentTurn({
      model,
      tools: registry,
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
    })
    const elapsed = Date.now() - start

    // 3 parallel 50ms tasks should complete well under 150ms (sequential time)
    expect(elapsed).toBeLessThan(120)

    for (const tool of tools) {
      expect(tool.run).toHaveBeenCalledOnce()
    }

    const toolResults = messages.filter(m => m.role === 'tool_result')
    expect(toolResults).toHaveLength(3)
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'done' })
  })

  it('mutating tool calls execute sequentially', async () => {
    let running = 0
    let maxRunning = 0

    const mutateTool = {
      name: 'write_file',
      description: 'write',
      inputSchema: {},
      schema: z.object({}).passthrough(),
      run: vi.fn(async () => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await sleep(30)
        running--
        return { ok: true, output: 'written' }
      }),
    }

    const registry = new ToolRegistry([mutateTool])

    const model: ModelAdapter = {
      next: vi
        .fn()
        .mockResolvedValueOnce({
          type: 'tool_calls',
          calls: [
            { id: '1', toolName: 'write_file', input: {} },
            { id: '2', toolName: 'write_file', input: {} },
            { id: '3', toolName: 'write_file', input: {} },
          ],
        } satisfies AgentStep)
        .mockResolvedValueOnce({
          type: 'assistant',
          content: 'done',
        } satisfies AgentStep),
    }

    await runAgentTurn({
      model,
      tools: registry,
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
    })

    expect(mutateTool.run).toHaveBeenCalledTimes(3)
    expect(maxRunning).toBe(1)
  })

  it('signal cancellation stops the loop early', async () => {
    const controller = new AbortController()
    controller.abort()

    const model: ModelAdapter = {
      next: vi.fn(async () => ({ type: 'assistant', content: 'should not reach' })),
    }

    const messages = await runAgentTurn({
      model,
      tools: new ToolRegistry([]),
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
      signal: controller.signal,
    })

    expect(model.next).not.toHaveBeenCalled()
    expect(messages.at(-1)?.role).toBe('assistant')
    expect((messages.at(-1) as { content: string }).content).toContain('cancelled')
  })

  it('awaitUser stops execution and returns', async () => {
    const onAssistantMessage = vi.fn()
    const registry = new ToolRegistry([
      {
        name: 'ask_user',
        description: 'ask',
        inputSchema: {},
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'What is your name?', awaitUser: true })),
      },
      {
        name: 'demo',
        description: 'demo',
        inputSchema: {},
        schema: z.object({}).passthrough(),
        run: vi.fn(async () => ({ ok: true, output: 'should not run' })),
      },
    ])

    const model: ModelAdapter = {
      next: vi.fn(async () => ({
        type: 'tool_calls',
        calls: [
          { id: '1', toolName: 'ask_user', input: {} },
          { id: '2', toolName: 'demo', input: {} },
        ],
      })),
    }

    const messages = await runAgentTurn({
      model,
      tools: registry,
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
      onAssistantMessage,
    })

    expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'What is your name?' })
    expect(onAssistantMessage).toHaveBeenCalledWith('What is your name?')
    // Model should only be called once (no second iteration)
    expect(model.next).toHaveBeenCalledOnce()
  })

  it('forwards onTextDelta and signal to model.next', async () => {
    const onTextDelta = vi.fn()
    const controller = new AbortController()
    const model: ModelAdapter = {
      next: vi.fn(async (_messages, options) => {
        options?.onTextDelta?.('hel')
        options?.onTextDelta?.('lo')
        expect(options?.signal).toBe(controller.signal)
        return { type: 'assistant', content: 'hello' }
      }),
    }

    const messages = await runAgentTurn({
      model,
      tools: new ToolRegistry([]),
      messages: [{ role: 'user', content: 'hello' }],
      cwd: process.cwd(),
      signal: controller.signal,
      onTextDelta,
    })

    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'hel')
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'lo')
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'hello' })
  })
})
