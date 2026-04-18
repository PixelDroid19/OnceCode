import { describe, expect, it } from 'vitest'
import { renderInputPrompt } from '@/tui/input.js'

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('tui/input', () => {
  it('renders the prompt and cursor', () => {
    const rendered = stripAnsi(renderInputPrompt('hello', 1))
    expect(rendered).toContain('prompt')
    expect(rendered).toContain('hello')
  })

  it('shows placeholder when input is empty', () => {
    expect(stripAnsi(renderInputPrompt('', 0))).toContain('Ask for code, files, tasks, or MCP tools')
  })
})
