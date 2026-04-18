import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearScreen,
  enterAlternateScreen,
  exitAlternateScreen,
  hideCursor,
  showCursor,
} from '@/tui/screen.js'

describe('tui/screen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the expected terminal control sequences', () => {
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write)

    hideCursor()
    showCursor()
    enterAlternateScreen()
    exitAlternateScreen()
    clearScreen()

    expect(writes[0]).toBe('\u001b[?25l')
    expect(writes[1]).toBe('\u001b[?25h')
    expect(writes[2]).toContain('\u001b[?1049h')
    expect(writes[3]).toContain('\u001b[?1049l')
    expect(writes[4]).toBe('\u001b[H\u001b[J')
  })
})
