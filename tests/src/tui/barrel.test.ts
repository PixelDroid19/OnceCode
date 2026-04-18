import { describe, expect, it } from 'vitest'
import * as tui from '@/tui/index.js'

describe('tui barrel', () => {
  it('exports TUI rendering functions from the barrel index', () => {
    expect(typeof tui.renderBanner).toBe('function')
    expect(typeof tui.renderInputPrompt).toBe('function')
    expect(typeof tui.renderTranscript).toBe('function')
    expect(typeof tui.enterAlternateScreen).toBe('function')
    expect(typeof tui.clearScreen).toBe('function')
    expect(typeof tui.hideCursor).toBe('function')
    expect(typeof tui.showCursor).toBe('function')
  })
})
