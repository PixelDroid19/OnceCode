import { describe, expect, it } from 'vitest'
import { renderMarkdownish } from '../../../src/tui/markdown.js'

describe('tui/markdown', () => {
  it('renders headings, bullets and inline code', () => {
    const rendered = renderMarkdownish('# Title\n- item\n`code`')
    expect(rendered).toContain('Title')
    expect(rendered).toContain('•')
    expect(rendered).toContain('code')
  })

  it('dims fenced code blocks', () => {
    const rendered = renderMarkdownish('```ts\nconst a = 1\n```')
    expect(rendered).toContain('const a = 1')
  })
})
