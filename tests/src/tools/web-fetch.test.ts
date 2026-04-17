import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchWebPage = vi.fn()

vi.mock('../../../src/utils/web.js', () => ({
  fetchWebPage,
}))

describe('tools/web-fetch', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('formats fetched page metadata', async () => {
    fetchWebPage.mockResolvedValueOnce({
      finalUrl: 'https://example.com/final',
      status: 200,
      statusText: 'OK',
      contentType: 'text/html',
      title: 'Demo',
      content: 'Hello world',
    })
    const { webFetchTool } = await import('../../../src/tools/web-fetch.js')
    const result = await webFetchTool.run({ url: 'https://example.com' }, { cwd: process.cwd() })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('TITLE: Demo')
    expect(result.output).toContain('Hello world')
  })

  it('returns http errors as failed tool results', async () => {
    fetchWebPage.mockResolvedValueOnce({
      finalUrl: 'https://example.com/final',
      status: 404,
      statusText: 'Not Found',
      contentType: 'text/html',
      title: null,
      content: '',
    })
    const { webFetchTool } = await import('../../../src/tools/web-fetch.js')
    const result = await webFetchTool.run({ url: 'https://example.com' }, { cwd: process.cwd() })
    expect(result).toEqual({ ok: false, output: 'HTTP 404 Not Found: https://example.com' })
  })
})
