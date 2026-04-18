import type { McpServerConfig } from './config.js'
import { t } from './i18n/index.js'
import type { ToolResult } from './tool.js'

/** Returns a human-readable label for an MCP server (URL or command string). */
export function summarizeServerEndpoint(config: McpServerConfig): string {
  const remoteUrl = config.url?.trim()
  if (remoteUrl) return remoteUrl
  const command = config.command?.trim() ?? ''
  const args = config.args?.join(' ') ?? ''
  return `${command} ${args}`.trim()
}

/** Converts arbitrary text to a safe lowercase slug for use in tool names. */
export function sanitizeToolSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tool'
  )
}

/** Ensures an MCP tool's input schema is a valid JSON Schema object. */
export function normalizeInputSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return schema
  }

  return {
    type: 'object',
    additionalProperties: true,
  }
}

function formatContentBlock(block: unknown): string {
  if (!block || typeof block !== 'object') {
    return JSON.stringify(block, null, 2)
  }

  if ('type' in block && block.type === 'text' && 'text' in block) {
    return String(block.text)
  }

  if ('type' in block && 'resource' in block) {
    return JSON.stringify(block, null, 2)
  }

  return JSON.stringify(block, null, 2)
}

/** Converts an MCP CallToolResult into the internal ToolResult format. */
export function formatToolCallResult(result: unknown): ToolResult {
  if (!result || typeof result !== 'object') {
    return {
      ok: true,
      output: JSON.stringify(result, null, 2),
    }
  }

  const typedResult = result as {
    content?: unknown[]
    structuredContent?: unknown
    isError?: boolean
  }

  const parts: string[] = []

  if (Array.isArray(typedResult.content) && typedResult.content.length > 0) {
    parts.push(typedResult.content.map(formatContentBlock).join('\n\n'))
  }

  if (typedResult.structuredContent !== undefined) {
    parts.push(
      `STRUCTURED_CONTENT:\n${JSON.stringify(typedResult.structuredContent, null, 2)}`,
    )
  }

  if (parts.length === 0) {
    parts.push(JSON.stringify(result, null, 2))
  }

  return {
    ok: !typedResult.isError,
    output: parts.join('\n\n').trim(),
  }
}

/** Converts an MCP ReadResourceResult into the internal ToolResult format. */
export function formatReadResourceResult(result: unknown): ToolResult {
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      output: JSON.stringify(result, null, 2),
    }
  }

  const typedResult = result as {
    contents?: Array<{
      uri?: string
      mimeType?: string
      text?: string
      blob?: string
    }>
  }

  const contents = typedResult.contents ?? []
  if (contents.length === 0) {
    return {
      ok: true,
      output: t('mcp_no_resource_contents'),
    }
  }

  return {
    ok: true,
    output: contents
      .map(item => {
        const headerLines = [`URI: ${item.uri ?? '(unknown)'}`]
        if (item.mimeType) {
          headerLines.push(`MIME: ${item.mimeType}`)
        }
        const header = `${headerLines.join('\n')}\n\n`

        if (typeof item.text === 'string') {
          return `${header}${item.text}`
        }

        if (typeof item.blob === 'string') {
          return `${header}BLOB:\n${item.blob}`
        }

        return `${header}${JSON.stringify(item, null, 2)}`
      })
      .join('\n\n'),
  }
}

/** Converts an MCP GetPromptResult into the internal ToolResult format. */
export function formatPromptResult(result: unknown): ToolResult {
  if (!result || typeof result !== 'object') {
    return {
      ok: false,
      output: JSON.stringify(result, null, 2),
    }
  }

  const typedResult = result as {
    description?: string
    messages?: Array<{
      role?: string
      content?: unknown
    }>
  }

  const header = typedResult.description
    ? `DESCRIPTION: ${typedResult.description}\n\n`
    : ''
  const body = (typedResult.messages ?? [])
    .map(message => {
      const role = message.role ?? 'unknown'
      if (typeof message.content === 'string') {
        return `[${role}]\n${message.content}`
      }
      if (Array.isArray(message.content)) {
        return `[${role}]\n${message.content
          .map(part => {
            if (typeof part === 'string') return part
            if (part && typeof part === 'object' && 'text' in part) {
              return String(part.text)
            }
            return JSON.stringify(part, null, 2)
          })
          .join('\n')}`
      }
      return `[${role}]\n${JSON.stringify(message.content, null, 2)}`
    })
    .join('\n\n')

  return {
    ok: true,
    output: `${header}${body}`.trim() || JSON.stringify(result, null, 2),
  }
}
