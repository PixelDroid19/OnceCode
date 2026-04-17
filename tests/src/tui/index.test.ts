import { describe, expect, it } from 'vitest'
import * as tui from '../../../src/tui/index.js'
import { renderBanner } from '../../../src/tui/chrome.js'
import { clearScreen } from '../../../src/tui/screen.js'
import { renderInputPrompt } from '../../../src/tui/input.js'

describe('tui/index', () => {
  it('re-exports chrome, input, screen, and transcript helpers', () => {
    expect(tui.renderBanner).toBe(renderBanner)
    expect(tui.renderInputPrompt).toBe(renderInputPrompt)
    expect(tui.clearScreen).toBe(clearScreen)
    expect(typeof tui.renderTranscript).toBe('function')
  })
})
