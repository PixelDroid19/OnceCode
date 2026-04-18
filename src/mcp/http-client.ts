import type { McpServerConfig } from '../config.js'
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
import { MCP_INITIALIZE_TIMEOUT_MS } from './types.js'
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
      throw new Error(`MCP server "${this.serverName}" has no URL configured.`)
    }

    this.bearerToken = (await loadMcpToken(this.serverName)) ?? null

    await this.request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'oncecode',
          version: '0.1.0',
        },
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
    const result = (await this.request('resources/list', {}, 3000)) as {
      resources?: McpResourceDescriptor[]
    }
    return result.resources ?? []
  }

  async readResource(uri: string): Promise<ToolResult> {
    const result = await this.request('resources/read', { uri }, 5000)
    return formatReadResourceResult(result)
  }

  async listPrompts(): Promise<McpPromptDescriptor[]> {
    const result = (await this.request('prompts/list', {}, 3000)) as {
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
      5000,
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
      await this.postJsonRpc({ jsonrpc: '2.0', method, params }, 2000)
    } catch {
      // Some servers ignore notifications over plain HTTP response mode.
    }
  }

  private async request(method: string, params: unknown, timeoutMs = 5000): Promise<unknown> {
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
      throw new Error(`MCP ${this.serverName}: invalid response payload.`)
    }

    const message = payload as JsonRpcMessage
    if (message.error) {
      throw new Error(
        `MCP ${this.serverName}: ${message.error.message}${
          message.error.data ? `\n${JSON.stringify(message.error.data, null, 2)}` : ''
        }`,
      )
    }
    return message.result
  }

  private async postJsonRpc(message: JsonRpcMessage, timeoutMs: number): Promise<unknown> {
    const endpoint = this.config.url?.trim()
    if (!endpoint) {
      throw new Error(`MCP server "${this.serverName}" has no URL configured.`)
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
        const lines = [`HTTP ${response.status} ${response.statusText}`]
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
          `MCP ${this.serverName}: expected JSON response but received non-JSON payload.`,
        )
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `MCP ${this.serverName}: request timed out for ${message.method ?? 'notification'}.`,
        )
      }
      throw error instanceof Error
        ? error
        : new Error(`MCP ${this.serverName}: ${String(error)}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}
