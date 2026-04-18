import { describe, expect, it } from 'vitest'
import {
  getTranscriptMaxScrollOffset,
  getTranscriptWindowSize,
  renderTranscript,
} from '@/tui/transcript.js'

describe('tui/transcript', () => {
  it('computes transcript window size safely', () => {
    expect(getTranscriptWindowSize(2)).toBe(4)
    expect(getTranscriptWindowSize(10)).toBe(10)
  })

  it('renders transcript entries', () => {
    const rendered = renderTranscript(
      [
        { id: 1, kind: 'user', body: 'hello' },
        { id: 2, kind: 'assistant', body: 'world' },
      ],
      0,
      20,
    )
    expect(rendered).toContain('you')
    expect(rendered).toContain('assistant')
  })

  it('reports scroll offset for truncated windows', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: index,
      kind: 'assistant' as const,
      body: `line-${index}`,
    }))
    expect(getTranscriptMaxScrollOffset(entries, 4)).toBeGreaterThan(0)
    expect(renderTranscript(entries, 2, 4)).toContain('scroll offset')
  })
})
