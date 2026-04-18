import type { McpServerConfig } from '../config.js'
import { t } from '../i18n/index.js'
import {
  formatPromptResult,
  formatReadResourceResult,
  formatToolCallResult,
} from '../mcp-tool-utils.js'
import type { ToolResult } from '../tool.js'
import type {
  JsonRpcMessage,
  JsonRpcProtocol,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpToolDescriptor,
} from './types.js'
import {
  MCP_CLIENT_INFO,
  MCP_INITIALIZE_TIMEOUT_MS,
  MCP_LIST_TIMEOUT_MS,
  MCP_NOTIFY_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  MCP_READ_TIMEOUT_MS,
  MCP_REQUEST_TIMEOUT_MS,
} from './constants.js'
import {
  extractAuthHint,
  loadMcpToken,
  resolveHeaderRecord,
} from './utils.js'

export class StreamableHttpMcpClient {
  private nextId = 1
  private bearerToken: string | null = null

  constructor(
    private readonly serverName: string,
    private readonly config: McpServerConfig,
  ) {}

  async start(): Promise<void> {
    if (!this.config.url?.trim()) {
      throw new Error(t('mcp_no_url', { name: this.serverName }))
    }

    this.bearerToken = (await loadMcpToken(this.serverName)) ?? null

    await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
      MCP_INITIALIZE_TIMEOUT_MS,
    )
    await this.notify('notifications/initialized', {})
  }

  getProtocol(): JsonRpcProtocol | null {
    return 'streamable-http'
  }

  getServerName(): string {
    return this.serverName
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request('tools/list', {})) as {
      tools?: McpToolDescriptor[]
    }
    return result.tools ?? []
  }

  async listResources(): Promise<McpResourceDescriptor[]> {
    const result = (await this.request('resources/list', {}, MCP_LIST_TIMEOUT_MS)) as {
      resources?: McpResourceDescriptor[]
    }
    return result.resources ?? []
  }

  async readResource(uri: string): Promise<ToolResult> {
    const result = await this.request('resources/read', { uri }, MCP_READ_TIMEOUT_MS)
    return formatReadResourceResult(result)
  }

  async listPrompts(): Promise<McpPromptDescriptor[]> {
    const result = (await this.request('prompts/list', {}, MCP_LIST_TIMEOUT_MS)) as {
      prompts?: McpPromptDescriptor[]
    }
    return result.prompts ?? []
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<ToolResult> {
    const result = await this.request(
      'prompts/get',
      {
        name,
        arguments: args ?? {},
      },
      MCP_READ_TIMEOUT_MS,
    )
    return formatPromptResult(result)
  }

  async callTool(name: string, input: unknown): Promise<ToolResult> {
    const result = await this.request('tools/call', {
      name,
      arguments: input ?? {},
    })
    return formatToolCallResult(result)
  }

  async close(): Promise<void> {
    return
  }

  private async notify(method: string, params: unknown): Promise<void> {
    try {
      await this.postJsonRpc({ jsonrpc: '2.0', method, params }, MCP_NOTIFY_TIMEOUT_MS)
    } catch {
      // Some servers ignore notifications over plain HTTP response mode.
    }
  }

  private async request(method: string, params: unknown, timeoutMs = MCP_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++
    const payload = await this.postJsonRpc(
      {
        jsonrpc: '2.0',
        id,
        method,
        params,
      },
      timeoutMs,
    )

    if (!payload || typeof payload !== 'object') {
      throw new Error(t('mcp_invalid_response', { name: this.serverName }))
    }

    const message = payload as JsonRpcMessage
    if (message.error) {
      throw new Error(
        `${t('mcp_server_error', { name: this.serverName, message: message.error.message })}${
          message.error.data ? `\n${JSON.stringify(message.error.data, null, 2)}` : ''
        }`,
      )
    }
    return message.result
  }

  private async postJsonRpc(message: JsonRpcMessage, timeoutMs: number): Promise<unknown> {
    const endpoint = this.config.url?.trim()
    if (!endpoint) {
      throw new Error(t('mcp_no_url', { name: this.serverName }))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Align with MCP streamable HTTP content negotiation behavior.
          accept: 'application/json, text/event-stream',
          ...resolveHeaderRecord(this.config.headers),
          ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      })

      if (!response.ok) {
        const authHint = extractAuthHint(response.headers)
        const bodyText = await response.text().catch(() => '')
        const detail = bodyText.trim().slice(0, 600)
        const lines = [t('mcp_http_error', { status: response.status, statusText: response.statusText })]
        if (authHint) {
          lines.push(`AUTH:\n${authHint}`)
        }
        if (detail) {
          lines.push(`BODY:\n${detail}`)
        }
        throw new Error(lines.join('\n'))
      }

      const responseText = await response.text()
      if (!responseText.trim()) {
        return {}
      }
      try {
        return JSON.parse(responseText) as unknown
      } catch {
        throw new Error(
          t('mcp_non_json_response', { name: this.serverName }),
        )
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          t('mcp_request_timeout', { name: this.serverName, method: message.method ?? 'notification' }),
        )
      }
      throw error instanceof Error
        ? error
        : new Error(`${t('mcp_server_error', { name: this.serverName, message: String(error) })}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}
