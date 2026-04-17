import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWebPage, searchDuckDuckGoLite } from '../../../src/utils/web.js'

describe('utils/web', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses duckduckgo-lite search results and filters domains', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        '<a class="result-link" href="https://example.com/a">Result A</a><td class="result-snippet">Snippet A</td>' +
          '<a class="result-link" href="https://blocked.com/b">Result B</a><td class="result-snippet">Snippet B</td>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    )

    const result = await searchDuckDuckGoLite({
      query: 'oncecode',
      blockedDomains: ['blocked.com'],
    })
    expect(result.organic).toHaveLength(1)
    expect(result.organic[0]?.title).toBe('Result A')
  })

  it('extracts readable content from html pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        '<html><head><title>Demo</title></head><body><h1>Hello</h1><p>World</p></body></html>',
        { status: 200, statusText: 'OK', headers: { 'content-type': 'text/html' } },
      ),
    )

    const result = await fetchWebPage({ url: 'https://example.com' })
    expect(result.title).toBe('Demo')
    expect(result.content).toContain('Hello World')
  })

  it('returns plain text content for non-html pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('plain body', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
      }),
    )

    const result = await fetchWebPage({ url: 'https://example.com/text' })
    expect(result.title).toBeNull()
    expect(result.content).toBe('plain body')
  })
})
