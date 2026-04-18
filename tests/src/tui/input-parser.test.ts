import { describe, expect, it } from 'vitest'
import { parseInputChunk } from '@/tui/input-parser.js'

describe('tui/input-parser', () => {
  it('parses return, text and backspace', () => {
    const parsed = parseInputChunk('', 'a\r\u007f')
    expect(parsed.events).toEqual([
      { kind: 'text', text: 'a', ctrl: false, meta: false },
      { kind: 'key', name: 'return', ctrl: false, meta: false },
      { kind: 'key', name: 'backspace', ctrl: false, meta: false },
    ])
  })

  it('parses arrow escape sequences', () => {
    const parsed = parseInputChunk('', '\u001b[A\u001b[B')
    expect(parsed.events).toEqual([
      { kind: 'key', name: 'up', ctrl: false, meta: false },
      { kind: 'key', name: 'down', ctrl: false, meta: false },
    ])
  })

  it('keeps incomplete escape sequences in rest', () => {
    const parsed = parseInputChunk('', '\u001b[')
    expect(parsed.rest).toBe('\u001b[')
  })
})
