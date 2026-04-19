import { afterEach, describe, expect, it } from 'vitest'
import {
  getPermissionPromptMaxScrollOffset,
  renderBanner,
  renderFooterBar,
  renderPanel,
  renderPermissionPrompt,
  renderSlashMenu,
  renderStatusLine,
  renderToolPanel,
} from '@/tui/chrome.js'

const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows')

function setTerminalSize(columns: number, rows = 40): void {
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    writable: true,
    value: columns,
  })
  Object.defineProperty(process.stdout, 'rows', {
    configurable: true,
    writable: true,
    value: rows,
  })
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('tui/chrome', () => {
  afterEach(() => {
    if (originalColumns) {
      Object.defineProperty(process.stdout, 'columns', originalColumns)
    } else {
      Reflect.deleteProperty(process.stdout, 'columns')
    }

    if (originalRows) {
      Object.defineProperty(process.stdout, 'rows', originalRows)
    } else {
      Reflect.deleteProperty(process.stdout, 'rows')
    }
  })

  it('renders a generic panel', () => {
    setTerminalSize(80)
    expect(renderPanel('title', 'body')).toContain('title')
  })

  it('renders the OnceCode banner content', () => {
    setTerminalSize(160)
    const rendered = stripAnsi(renderBanner(
      {
        provider: {
          id: 'anthropic',
          name: 'Anthropic',
          transport: 'anthropic',
          baseUrl: 'https://example.com',
          auth: {
            env: 'ANTHROPIC_AUTH_TOKEN',
            type: 'bearer',
            value: 'token',
          },
        },
        model: {
          id: 'demo',
          ref: 'anthropic:demo',
          name: 'demo',
          api: 'demo',
          providerId: 'anthropic',
          aliases: [],
          defaultOutput: 32_000,
          limits: { context: 200_000, output: 64_000 },
          capabilities: {
            attachment: true,
            reasoning: false,
            temperature: true,
            toolCall: true,
            interleaved: false,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
          },
          known: false,
        },
        modelRef: 'anthropic:demo',
        mcpServers: {},
        sourceSummary: 'test',
      },
      '/tmp/project',
      ['cwd: /tmp/project'],
      {
        transcriptCount: 2,
        messageCount: 3,
        skillCount: 1,
        mcpTotalCount: 1,
        mcpConnectedCount: 1,
        mcpConnectingCount: 0,
        mcpErrorCount: 0,
      },
    ))
    expect(rendered).toContain('OnceCode')
    expect(rendered).toContain('demo')
  })

  it('renders footer and tool panels', () => {
    setTerminalSize(120)
    expect(renderStatusLine('busy')).toContain('busy')
    expect(renderToolPanel('read_file', [{ name: 'write_file', status: 'success' }], [])).toContain('read_file')
    expect(
      renderFooterBar('ready', true, true, {
        total: 1,
        connected: 1,
        connecting: 0,
        error: 0,
        toolCount: 3,
      }),
    ).toContain('mcp srv')
  })

  it('renders slash menus and permission prompts', () => {
    setTerminalSize(100, 30)
    const menu = renderSlashMenu([
      { name: '/help', usage: '/help', description: 'Show help' },
    ], 0)
    expect(menu).toContain('/help')

    const request = {
      kind: 'edit' as const,
      summary: 'apply edit',
      details: ['--- a/file\n+++ b/file\n@@\n-old\n+new'],
      scope: '/tmp/file',
      choices: [
        { key: '1', label: 'apply once', decision: 'allow_once' as const },
      ],
    }
    expect(getPermissionPromptMaxScrollOffset(request, { expanded: true })).toBeGreaterThanOrEqual(0)
    expect(renderPermissionPrompt(request, { selectedChoiceIndex: 0 })).toContain('Approval Required')
  })
})
