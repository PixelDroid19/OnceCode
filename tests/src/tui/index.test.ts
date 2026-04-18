import { describe, expect, it } from 'vitest'
import * as tui from '@/tui/index.js'
import { renderBanner } from '@/tui/chrome.js'
import { clearScreen } from '@/tui/screen.js'
import { renderInputPrompt } from '@/tui/input.js'

describe('tui/index', () => {
  it('re-exports chrome, input, screen, and transcript helpers', () => {
    expect(tui.renderBanner).toBe(renderBanner)
    expect(tui.renderInputPrompt).toBe(renderInputPrompt)
    expect(tui.clearScreen).toBe(clearScreen)
    expect(typeof tui.renderTranscript).toBe('function')
  })
})
