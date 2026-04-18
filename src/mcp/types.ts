import type { ToolResult } from '../tool.js'

export type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpResourceDescriptor = {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export type McpPromptArgument = {
  name: string
  description?: string
  required?: boolean
}

export type McpPromptDescriptor = {
  name: string
  description?: string
  arguments?: McpPromptArgument[]
}

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type McpServerSummary = {
  name: string
  command: string
  status: 'connecting' | 'connected' | 'error' | 'disabled'
  toolCount: number
  error?: string
  protocol?: JsonRpcProtocol
  resourceCount?: number
  promptCount?: number
}

export type JsonRpcProtocol = 'content-length' | 'newline-json' | 'streamable-http'

export const MCP_INITIALIZE_TIMEOUT_MS = 10000
export const MCP_INITIALIZE_PROBE_TIMEOUT_MS = 1200

export type ProtocolCache = Record<string, JsonRpcProtocol>

export type McpClientLike = {
  start(): Promise<void>
  getProtocol(): JsonRpcProtocol | null
  getServerName(): string
  listTools(): Promise<McpToolDescriptor[]>
  listResources(): Promise<McpResourceDescriptor[]>
  readResource(uri: string): Promise<ToolResult>
  listPrompts(): Promise<McpPromptDescriptor[]>
  getPrompt(name: string, args?: Record<string, string>): Promise<ToolResult>
  callTool(name: string, input: unknown): Promise<ToolResult>
  close(): Promise<void>
}
