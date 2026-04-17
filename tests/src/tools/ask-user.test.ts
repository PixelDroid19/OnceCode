import { describe, expect, it } from 'vitest'
import { askUserTool } from '../../../src/tools/ask-user.js'

describe('tools/ask-user', () => {
  it('returns awaitUser responses', async () => {
    await expect(askUserTool.run({ question: '  clarify?  ' }, { cwd: process.cwd() })).resolves.toEqual({
      ok: true,
      output: 'clarify?',
      awaitUser: true,
    })
  })
})
