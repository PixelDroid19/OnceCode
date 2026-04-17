import { describe, expect, it } from 'vitest'
import { summarizeMcpServers } from '../../src/mcp-status.js'

describe('mcp-status', () => {
  it('summarizes MCP server counts', () => {
    expect(
      summarizeMcpServers([
        { name: 'a', command: 'a', status: 'connected', toolCount: 2 },
        { name: 'b', command: 'b', status: 'connecting', toolCount: 0 },
        { name: 'c', command: 'c', status: 'error', toolCount: 0 },
      ]),
    ).toEqual({
      total: 3,
      connected: 1,
      connecting: 1,
      error: 1,
      toolCount: 2,
    })
  })
})
