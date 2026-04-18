import type { AgentStep, ChatMessage, ModelAdapter } from './types.js'
import { t } from './i18n/index.js'
import { estimateMessagesTokenCount } from './utils/context.js'

function lastUserMessage(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find(message => message.role === 'user')
  return last?.content ?? ''
}

function lastToolMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find(message => message.role === 'tool_result')
}

function extractLatestAssistantCall(messages: ChatMessage[]): string | undefined {
  const last = [...messages]
    .reverse()
    .find(
      message =>
        message.role === 'assistant_tool_call',
    )
  return last?.role === 'assistant_tool_call'
    ? last.toolName
    : undefined
}

export class MockModelAdapter implements ModelAdapter {
  async next(messages: ChatMessage[]): Promise<AgentStep> {
    // Generate mock usage based on estimated token count
    const estimatedInput = estimateMessagesTokenCount(messages)
    const mockUsage = {
      inputTokens: estimatedInput,
      outputTokens: 100,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    }

    const toolMessage = lastToolMessage(messages)
    if (toolMessage?.role === 'tool_result') {
      const lastCall = extractLatestAssistantCall(messages)
      if (lastCall === 'list_files') {
        return {
          type: 'assistant',
          content: t('mock_directory_contents', {
            content: toolMessage.content,
          }),
          usage: mockUsage,
        }
      }

      if (lastCall === 'read_file') {
        return {
          type: 'assistant',
          content: t('mock_file_contents', {
            content: toolMessage.content,
          }),
          usage: mockUsage,
        }
      }

      if (lastCall === 'write_file' || lastCall === 'edit_file') {
        return {
          type: 'assistant',
          content: toolMessage.content,
          usage: mockUsage,
        }
      }

      return {
        type: 'assistant',
        content: t('mock_tool_result', {
          content: toolMessage.content,
        }),
        usage: mockUsage,
      }
    }

    const userText = lastUserMessage(messages).trim()

    if (userText === '/tools') {
      return {
        type: 'assistant',
        content: t('mock_available_tools'),
        usage: mockUsage,
      }
    }

    if (userText.startsWith('/ls')) {
      const dir = userText.replace('/ls', '').trim()
      return {
        type: 'tool_calls',
        calls: [{
          id: `mock-${Date.now()}`,
          toolName: 'list_files',
          input: dir ? { path: dir } : {},
        }],
        usage: mockUsage,
      }
    }

    if (userText.startsWith('/grep ')) {
      const payload = userText.slice('/grep '.length).trim()
      const [pattern, searchPath] = payload.split('::')
      return {
        type: 'tool_calls',
        calls: [{
          id: `mock-${Date.now()}`,
          toolName: 'grep_files',
          input: {
            pattern: pattern.trim(),
            path: searchPath?.trim() || undefined,
          },
        }],
        usage: mockUsage,
      }
    }

    if (userText.startsWith('/read ')) {
      return {
        type: 'tool_calls',
        calls: [{
          id: `mock-${Date.now()}`,
          toolName: 'read_file',
          input: { path: userText.slice('/read '.length).trim() },
        }],
        usage: mockUsage,
      }
    }

    if (userText.startsWith('/cmd ')) {
      const parts = userText.slice('/cmd '.length).trim().split(/\s+/)
      const [command, ...args] = parts
      return {
        type: 'tool_calls',
        calls: [{
          id: `mock-${Date.now()}`,
          toolName: 'run_command',
          input: { command, args },
        }],
        usage: mockUsage,
      }
    }

    if (userText.startsWith('/write ')) {
      const payload = userText.slice('/write '.length)
      const splitAt = payload.indexOf('::')
      if (splitAt === -1) {
        return {
          type: 'assistant',
          content: t('tool_write_usage'),
          usage: mockUsage,
        }
      }

      return {
        type: 'tool_calls',
        calls: [{
          id: `mock-${Date.now()}`,
          toolName: 'write_file',
          input: {
            path: payload.slice(0, splitAt).trim(),
            content: payload.slice(splitAt + 2),
          },
        }],
        usage: mockUsage,
      }
    }

    if (userText.startsWith('/edit ')) {
      const payload = userText.slice('/edit '.length)
      const [targetPath, search, replace] = payload.split('::')
      if (!targetPath || search === undefined || replace === undefined) {
        return {
          type: 'assistant',
          content: t('tool_edit_usage'),
          usage: mockUsage,
        }
      }

      return {
        type: 'tool_calls',
        calls: [{
          id: `mock-${Date.now()}`,
          toolName: 'edit_file',
          input: {
            path: targetPath.trim(),
            search,
            replace,
          },
        }],
        usage: mockUsage,
      }
    }

    return {
      type: 'assistant',
      content: [
        t('mock_skeleton_intro'),
        t('mock_suggestions'),
        '/tools',
        '/ls',
        '/grep pattern::src',
        '/read README.md',
        '/cmd pwd',
        '/write notes.txt::hello',
        '/edit notes.txt::hello::hello world',
      ].join('\n'),
      usage: mockUsage,
    }
  }
}
