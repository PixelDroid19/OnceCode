import { afterEach, describe, expect, it, vi } from 'vitest'

const searchDuckDuckGoLite = vi.fn()

vi.mock('@/utils/web.js', () => ({
  searchDuckDuckGoLite,
}))

describe('tools/web-search', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('formats organic results', async () => {
    searchDuckDuckGoLite.mockResolvedValueOnce({
      organic: [
        { title: 'Result 1', link: 'https://example.com', snippet: 'Snippet', date: '', display_link: 'example.com' },
      ],
      base_resp: { status_code: 200, status_msg: 'OK', source: 'duckduckgo-lite' },
    })
    const { webSearchTool } = await import('@/tools/web-search.js')
    const result = await webSearchTool.run({ query: 'oncecode' }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('QUERY: oncecode')
    expect(result.output).toContain('Result 1')
  })

  it('reports empty result sets', async () => {
    searchDuckDuckGoLite.mockResolvedValueOnce({
      organic: [],
      base_resp: { status_code: 200, status_msg: 'OK', source: 'duckduckgo-lite' },
    })
    const { webSearchTool } = await import('@/tools/web-search.js')
    const result = await webSearchTool.run({ query: 'oncecode' }, { cwd: process.cwd() })
    expect(result).toEqual({ ok: true, output: 'No results found.' })
  })
})
