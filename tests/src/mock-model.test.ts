import { describe, expect, it } from 'vitest'
import { MockModelAdapter } from '../../src/mock-model.js'

describe('mock-model', () => {
  it('turns slash shortcuts into tool calls', async () => {
    const model = new MockModelAdapter()
    await expect(model.next([{ role: 'user', content: '/ls src' }])).resolves.toMatchObject({
      type: 'tool_calls',
      calls: [{ toolName: 'list_files', input: { path: 'src' } }],
    })
  })

  it('summarizes tool results back to assistant text', async () => {
    const model = new MockModelAdapter()
    await expect(
      model.next([
        { role: 'assistant_tool_call', toolUseId: '1', toolName: 'read_file', input: {} },
        { role: 'tool_result', toolUseId: '1', toolName: 'read_file', content: 'hello', isError: false },
      ]),
    ).resolves.toEqual({
      type: 'assistant',
      content: 'File contents:\n\nhello',
    })
  })
})
