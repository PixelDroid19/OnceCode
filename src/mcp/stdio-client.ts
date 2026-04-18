import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
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
  PendingRequest,
} from './types.js'
import {
  MCP_CLIENT_INFO,
  MCP_INITIALIZE_PROBE_TIMEOUT_MS,
  MCP_INITIALIZE_TIMEOUT_MS,
  MCP_LIST_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  MCP_READ_TIMEOUT_MS,
  MCP_REQUEST_TIMEOUT_MS,
} from './constants.js'
import {
  formatChildProcessError,
  isInitializeTimeoutError,
} from './utils.js'

export class StdioMcpClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private buffer = Buffer.alloc(0)
  private lineBuffer = ''
  private pending = new Map<number, PendingRequest>()
  private stderrLines: string[] = []
  private protocol: JsonRpcProtocol | null = null

  constructor(
    private readonly serverName: string,
    private readonly config: McpServerConfig,
    private readonly cwd: string,
    private readonly preferredProtocol?: JsonRpcProtocol,
  ) {}

  async start(): Promise<void> {
    if (this.process) {
      return
    }

    const protocols = this.getProtocolCandidates()
    const autoProtocol =
      this.config.protocol === undefined || this.config.protocol === 'auto'
    let lastError: Error | null = null

    for (let index = 0; index < protocols.length; index += 1) {
      const protocol = protocols[index]!
      const useProbeTimeout =
        autoProtocol && !this.preferredProtocol && index === 0
      const timeoutMs =
        useProbeTimeout
          ? MCP_INITIALIZE_PROBE_TIMEOUT_MS
          : MCP_INITIALIZE_TIMEOUT_MS
      try {
        await this.initializeWithProtocol(protocol, timeoutMs)
        return
      } catch (error) {
        // Fast probe can be too short on cold starts: retry the same protocol once
        // with full timeout before falling back to another framing format.
        if (useProbeTimeout && isInitializeTimeoutError(error)) {
          await this.close()
          try {
            await this.initializeWithProtocol(protocol, MCP_INITIALIZE_TIMEOUT_MS)
            return
          } catch (retryError) {
            lastError =
              retryError instanceof Error
                ? retryError
                : new Error(String(retryError))
            await this.close()
            continue
          }
        }
        lastError = error instanceof Error ? error : new Error(String(error))
        await this.close()
      }
    }

    throw lastError ?? new Error(`Failed to connect MCP server "${this.serverName}".`)
  }

  getProtocol(): JsonRpcProtocol | null {
    return this.protocol
  }

  getServerName(): string {
    return this.serverName
  }

  private async initializeWithProtocol(
    protocol: JsonRpcProtocol,
    timeoutMs: number,
  ): Promise<void> {
    await this.spawnProcess()
    this.protocol = protocol
    await this.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
      timeoutMs,
    )
    this.notify('notifications/initialized', {})
  }

  private getProtocolCandidates(): JsonRpcProtocol[] {
    if (this.config.protocol === 'content-length') {
      return ['content-length']
    }
    if (this.config.protocol === 'newline-json') {
      return ['newline-json']
    }
    if (this.preferredProtocol === 'newline-json') {
      return ['newline-json', 'content-length']
    }
    return ['content-length', 'newline-json']
  }

  private async spawnProcess(): Promise<void> {
    const command = (this.config.command ?? '').trim()
    if (!command) {
      throw new Error(`MCP server "${this.serverName}" has no command configured.`)
    }

    this.buffer = Buffer.alloc(0)
    this.lineBuffer = ''
    this.stderrLines = []
    this.pending.clear()

    const child = spawn(command, this.config.args ?? [], {
      cwd: this.config.cwd ? path.resolve(this.cwd, this.config.cwd) : this.cwd,
      env: {
        ...process.env,
        ...Object.fromEntries(
          Object.entries(this.config.env ?? {}).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
      },
      stdio: 'pipe',
    })

    this.process = child
    const handleProcessError = (error: unknown) => {
      const wrapped = formatChildProcessError(
        this.serverName,
        command,
        this.stderrLines,
        error,
      )

      if (this.process === child) {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout)
          pending.reject(wrapped)
        }
        this.pending.clear()
        this.process = null
      }
    }

    child.stdout.on('data', chunk => {
      if (this.process !== child) {
        return
      }
      this.handleStdoutChunk(Buffer.from(chunk))
    })
    child.stderr.on('data', chunk => {
      if (this.process !== child) {
        return
      }
      this.stderrLines.push(String(chunk).trim())
      this.stderrLines = this.stderrLines.filter(Boolean).slice(-8)
    })
    child.on('error', handleProcessError)
    child.on('exit', code => {
      if (this.process !== child) {
        return
      }
      const error = new Error(
        `MCP server "${this.serverName}" exited with code ${code ?? 'unknown'}${
          this.stderrLines.length > 0
            ? `\n${this.stderrLines.join('\n')}`
            : ''
        }`,
      )
      for (const pending of this.pending.values()) {
        pending.reject(error)
      }
      this.pending.clear()
      this.process = null
    })

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onInitialError)
        resolve()
      }
      const onInitialError = (error: unknown) => {
        child.off('spawn', onSpawn)
        reject(
          formatChildProcessError(this.serverName, command, this.stderrLines, error),
        )
      }

      child.once('spawn', onSpawn)
      child.once('error', onInitialError)
    })
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

  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<ToolResult> {
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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(
        new Error(`MCP server "${this.serverName}" closed before completing the request.`),
      )
    }
    this.pending.clear()

    if (!this.process) {
      this.protocol = null
      return
    }

    this.process.kill()
    this.process = null
    this.protocol = null
  }

  private notify(method: string, params: unknown): void {
    this.send({
      jsonrpc: '2.0',
      method,
      params,
    })
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = MCP_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(
            `MCP ${this.serverName}: request timed out for ${method}${
              this.stderrLines.length > 0 ? `\n${this.stderrLines.join('\n')}` : ''
            }`,
          ),
        )
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      this.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })
    })
  }

  private send(message: JsonRpcMessage): void {
    if (!this.process) {
      throw new Error(`MCP server "${this.serverName}" is not running.`)
    }

    const body = Buffer.from(JSON.stringify(message), 'utf8')
    if (this.protocol === 'newline-json') {
      this.process.stdin.write(`${body.toString('utf8')}\n`)
      return
    }

    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
    this.process.stdin.write(Buffer.concat([header, body]))
  }

  private handleStdoutChunk(chunk: Buffer): void {
    if (this.protocol === 'newline-json') {
      this.handleStdoutChunkAsLines(chunk)
      return
    }

    this.buffer = Buffer.concat([this.buffer, chunk])

    while (true) {
      const separatorIndex = this.buffer.indexOf('\r\n\r\n')
      if (separatorIndex === -1) {
        return
      }

      const headerText = this.buffer
        .subarray(0, separatorIndex)
        .toString('utf8')
      const headers = headerText.split('\r\n')
      const contentLengthHeader = headers.find(line =>
        line.toLowerCase().startsWith('content-length:'),
      )
      if (!contentLengthHeader) {
        this.buffer = this.buffer.subarray(separatorIndex + 4)
        continue
      }

      const contentLength = Number(contentLengthHeader.split(':')[1]?.trim() ?? 0)
      const bodyStart = separatorIndex + 4
      const bodyEnd = bodyStart + contentLength

      if (this.buffer.length < bodyEnd) {
        return
      }

      const payload = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8')
      this.buffer = this.buffer.subarray(bodyEnd)
      this.handleMessage(JSON.parse(payload) as JsonRpcMessage)
    }
  }

  private handleStdoutChunkAsLines(chunk: Buffer): void {
    this.lineBuffer += chunk.toString('utf8')

    while (true) {
      const newlineIndex = this.lineBuffer.indexOf('\n')
      if (newlineIndex === -1) {
        return
      }

      const rawLine = this.lineBuffer.slice(0, newlineIndex)
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1)
      const line = rawLine.trim()
      if (!line) {
        continue
      }

      this.handleMessage(JSON.parse(line) as JsonRpcMessage)
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (typeof message.id !== 'number') {
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) {
      return
    }

    this.pending.delete(message.id)
    clearTimeout(pending.timeout)

    if (message.error) {
      pending.reject(
        new Error(
          `MCP ${this.serverName}: ${message.error.message}${
            message.error.data ? `\n${JSON.stringify(message.error.data, null, 2)}` : ''
          }`,
        ),
      )
      return
    }

    pending.resolve(message.result)
  }
}
