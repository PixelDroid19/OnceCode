import { z } from 'zod'
import type { McpServerConfig } from '../config.js'
import {
  createMcpPromptTools,
  createMcpResourceTools,
} from '../mcp-helper-tools.js'
import {
  normalizeInputSchema,
  sanitizeToolSegment,
  summarizeServerEndpoint,
} from '../mcp-tool-utils.js'
import type { ToolDefinition } from '../tool.js'
import { StreamableHttpMcpClient } from './http-client.js'
import { readProtocolCache, writeProtocolCache } from './protocol-cache.js'
import { StdioMcpClient } from './stdio-client.js'
import type {
  JsonRpcProtocol,
  McpClientLike,
  McpServerSummary,
} from './types.js'

export async function createMcpBackedTools(args: {
  cwd: string
  mcpServers: Record<string, McpServerConfig>
}): Promise<{
  tools: ToolDefinition<unknown>[]
  servers: McpServerSummary[]
  dispose: () => Promise<void>
}> {
  const protocolCache = await readProtocolCache()
  let protocolCacheDirty = false
  const clients: McpClientLike[] = []
  const clientsByServer = new Map<string, McpClientLike>()
  const tools: ToolDefinition<unknown>[] = []
  const servers: McpServerSummary[] = []
  let hasPublishedResources = false
  let hasPublishedPrompts = false

  for (const [serverName, config] of Object.entries(args.mcpServers)) {
    const endpointKey = `${serverName}::${summarizeServerEndpoint(config)}`
    if (config.enabled === false) {
      servers.push({
        name: serverName,
        command: summarizeServerEndpoint(config),
        status: 'disabled',
        toolCount: 0,
        protocol:
          config.protocol === 'auto' || config.protocol === undefined
            ? undefined
            : config.protocol,
      })
      continue
    }

    const protocolHint = config.protocol
    const remoteUrl = config.url?.trim()
    const selectedProtocol: JsonRpcProtocol =
      protocolHint === 'streamable-http'
        ? 'streamable-http'
        : protocolHint === 'content-length'
          ? 'content-length'
          : protocolHint === 'newline-json'
            ? 'newline-json'
            : remoteUrl
              ? 'streamable-http'
              : 'content-length'

    const client: McpClientLike =
      selectedProtocol === 'streamable-http'
        ? new StreamableHttpMcpClient(serverName, config)
        : new StdioMcpClient(
            serverName,
            config,
            args.cwd,
            protocolCache[endpointKey],
          )

    try {
      await client.start()
      const descriptors = await client.listTools()
      const [resourcesResult, promptsResult] = await Promise.allSettled([
        client.listResources(),
        client.listPrompts(),
      ])
      const resourceCount =
        resourcesResult.status === 'fulfilled'
          ? resourcesResult.value.length
          : undefined
      const promptCount =
        promptsResult.status === 'fulfilled'
          ? promptsResult.value.length
          : undefined
      hasPublishedResources = hasPublishedResources || (resourceCount ?? 0) > 0
      hasPublishedPrompts = hasPublishedPrompts || (promptCount ?? 0) > 0
      clients.push(client)
      clientsByServer.set(serverName, client)
      const negotiated = client.getProtocol()
      if (
        negotiated &&
        negotiated !== 'streamable-http' &&
        protocolCache[endpointKey] !== negotiated
      ) {
        protocolCache[endpointKey] = negotiated
        protocolCacheDirty = true
      }

      for (const descriptor of descriptors) {
        const wrappedName = `mcp__${sanitizeToolSegment(serverName)}__${sanitizeToolSegment(
          descriptor.name,
        )}`
        const inputSchema = normalizeInputSchema(descriptor.inputSchema)
        tools.push({
          name: wrappedName,
          description:
            descriptor.description?.trim() ||
            `Call MCP tool ${descriptor.name} from server ${serverName}.`,
          inputSchema,
          schema: z.unknown(),
          async run(input) {
            return client.callTool(descriptor.name, input)
          },
        })
      }

      servers.push({
        name: serverName,
        command: summarizeServerEndpoint(config),
        status: 'connected',
        toolCount: descriptors.length,
        resourceCount,
        promptCount,
        protocol: client.getProtocol() ?? undefined,
      })
    } catch (error) {
      await client.close()
      servers.push({
        name: serverName,
        command: summarizeServerEndpoint(config),
        status: 'error',
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
        protocol:
          config.protocol === 'auto' || config.protocol === undefined
            ? undefined
            : config.protocol,
      })
    }
  }

  if (protocolCacheDirty) {
    await writeProtocolCache(protocolCache).catch(() => {
      // Ignore protocol cache persistence failures.
    })
  }

  if (clientsByServer.size > 0 && hasPublishedResources) {
    tools.push(...createMcpResourceTools(clientsByServer))
  }

  if (clientsByServer.size > 0 && hasPublishedPrompts) {
    tools.push(...createMcpPromptTools(clientsByServer))
  }

  return {
    tools,
    servers,
    async dispose() {
      await Promise.all(clients.map(client => client.close()))
    },
  }
}
