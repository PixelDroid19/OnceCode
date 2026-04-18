/**
 * MCP type definitions and protocol interfaces.
 *
 * Defines the JSON-RPC message shape, server/client descriptors, and
 * the {@link McpClientLike} contract implemented by both the stdio and
 * streamable-HTTP transports.
 */

import type { ToolResult } from '@/tools/framework.js'

/** A single JSON-RPC 2.0 message (request, response, or notification). */
export type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Descriptor returned by `tools/list` for a single MCP tool. */
export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** Descriptor returned by `resources/list` for a single resource. */
export type McpResourceDescriptor = {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

/** A single argument accepted by an MCP prompt template. */
export type McpPromptArgument = {
  name: string
  description?: string
  required?: boolean
}

/** Descriptor returned by `prompts/list` for a single prompt. */
export type McpPromptDescriptor = {
  name: string
  description?: string
  arguments?: McpPromptArgument[]
}

/** In-flight JSON-RPC request awaiting a response or timeout. */
export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/** Aggregated status of a single MCP server connection. */
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

/** Framing protocol used for MCP communication. */
export type JsonRpcProtocol = 'content-length' | 'newline-json' | 'streamable-http'

/** Cached mapping of server endpoint keys to their negotiated protocol. */
export type ProtocolCache = Record<string, JsonRpcProtocol>

/**
 * Common interface implemented by every MCP client transport.
 *
 * Both {@link StdioMcpClient} and {@link StreamableHttpMcpClient}
 * satisfy this contract so the registry can treat them uniformly.
 */
export type McpClientLike = {
  /** Perform the MCP initialize handshake. */
  start(): Promise<void>
  /** Return the negotiated framing protocol, or `null` before start. */
  getProtocol(): JsonRpcProtocol | null
  /** Return the human-readable server name. */
  getServerName(): string
  /** Enumerate tools exposed by the server. */
  listTools(): Promise<McpToolDescriptor[]>
  /** Enumerate resources published by the server. */
  listResources(): Promise<McpResourceDescriptor[]>
  /** Read a single resource by URI. */
  readResource(uri: string): Promise<ToolResult>
  /** Enumerate prompt templates published by the server. */
  listPrompts(): Promise<McpPromptDescriptor[]>
  /** Expand a prompt template with the given arguments. */
  getPrompt(name: string, args?: Record<string, string>): Promise<ToolResult>
  /** Invoke a tool by name with arbitrary JSON input. */
  callTool(name: string, input: unknown): Promise<ToolResult>
  /** Terminate the transport and reject any pending requests. */
  close(): Promise<void>
}
