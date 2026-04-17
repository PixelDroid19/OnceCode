import { describe, expect, it } from 'vitest'
import * as ui from '../../src/ui.js'
import { renderBanner as renderBannerFromIndex } from '../../src/tui/index.js'

describe('ui', () => {
  it('re-exports TUI rendering functions from the UI surface', () => {
    expect(ui.renderBanner).toBe(renderBannerFromIndex)
    expect(typeof ui.renderInputPrompt).toBe('function')
    expect(typeof ui.renderTranscript).toBe('function')
    expect(typeof ui.enterAlternateScreen).toBe('function')
  })
})
