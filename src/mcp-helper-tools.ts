import { z } from 'zod'
import type { McpClientLike } from './mcp.js'
import { t } from './i18n/index.js'
import type { ToolDefinition } from './tool.js'

function getTargetClients(
  clientsByServer: Map<string, McpClientLike>,
  server?: string,
): McpClientLike[] {
  if (server) {
    return [clientsByServer.get(server)].filter(
      (client): client is McpClientLike => client !== undefined,
    )
  }

  return [...clientsByServer.values()]
}

/** Creates tools for listing and reading MCP resources from connected servers. */
export function createMcpResourceTools(
  clientsByServer: Map<string, McpClientLike>,
): ToolDefinition<unknown>[] {
  const listResourcesTool = {
    name: 'list_mcp_resources',
    description:
      'List optional MCP resources exposed by connected MCP servers when a server actually publishes them.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
      },
    },
    schema: z.object({
      server: z.string().optional(),
    }),
    async run(input: { server?: string }) {
      const targetClients = getTargetClients(clientsByServer, input.server)
      const lines: string[] = []
      for (const client of targetClients) {
        try {
          const resources = await client.listResources()
          for (const resource of resources) {
            lines.push(
              `${client.getServerName()}: ${resource.uri}${resource.name ? ` (${resource.name})` : ''}${resource.description ? ` - ${resource.description}` : ''}`,
            )
          }
        } catch (error) {
          lines.push(
            `${client.getServerName()}: failed to list resources (${error instanceof Error ? error.message : String(error)})`,
          )
        }
      }
      return {
        ok: true,
        output:
          lines.length > 0
            ? lines.join('\n')
            : t('mcp_no_resources'),
      }
    },
  } satisfies ToolDefinition<{ server?: string }>

  const readResourceTool = {
    name: 'read_mcp_resource',
    description: 'Read a specific optional MCP resource by server and URI.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        uri: { type: 'string' },
      },
      required: ['server', 'uri'],
    },
    schema: z.object({
      server: z.string().min(1),
      uri: z.string().min(1),
    }),
    async run(input: { server: string; uri: string }) {
      const client = clientsByServer.get(input.server)
      if (!client) {
        return {
          ok: false,
          output: t('mcp_unknown_server', { server: input.server }),
        }
      }
      return client.readResource(input.uri)
    },
  } satisfies ToolDefinition<{ server: string; uri: string }>

  return [
    listResourcesTool as ToolDefinition<unknown>,
    readResourceTool as ToolDefinition<unknown>,
  ]
}

/** Creates tools for listing and fetching MCP prompts from connected servers. */
export function createMcpPromptTools(
  clientsByServer: Map<string, McpClientLike>,
): ToolDefinition<unknown>[] {
  const listPromptsTool = {
    name: 'list_mcp_prompts',
    description:
      'List optional MCP prompts exposed by connected MCP servers when a server actually publishes them.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
      },
    },
    schema: z.object({
      server: z.string().optional(),
    }),
    async run(input: { server?: string }) {
      const targetClients = getTargetClients(clientsByServer, input.server)
      const lines: string[] = []
      for (const client of targetClients) {
        try {
          const prompts = await client.listPrompts()
          for (const prompt of prompts) {
            const argsSummary = (prompt.arguments ?? [])
              .map(arg => `${arg.name}${arg.required ? '*' : ''}`)
              .join(', ')
            lines.push(
              `${client.getServerName()}: ${prompt.name}${argsSummary ? ` args=[${argsSummary}]` : ''}${prompt.description ? ` - ${prompt.description}` : ''}`,
            )
          }
        } catch (error) {
          lines.push(
            `${client.getServerName()}: failed to list prompts (${error instanceof Error ? error.message : String(error)})`,
          )
        }
      }
      return {
        ok: true,
        output:
          lines.length > 0
            ? lines.join('\n')
            : t('mcp_no_prompts'),
      }
    },
  } satisfies ToolDefinition<{ server?: string }>

  const getPromptTool = {
    name: 'get_mcp_prompt',
    description:
      'Fetch a rendered optional MCP prompt by server, prompt name, and optional arguments.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string' },
        name: { type: 'string' },
        arguments: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['server', 'name'],
    },
    schema: z.object({
      server: z.string().min(1),
      name: z.string().min(1),
      arguments: z.record(z.string(), z.string()).optional(),
    }),
    async run(input: {
      server: string
      name: string
      arguments?: Record<string, string>
    }) {
      const client = clientsByServer.get(input.server)
      if (!client) {
        return {
          ok: false,
          output: t('mcp_unknown_server', { server: input.server }),
        }
      }
      return client.getPrompt(input.name, input.arguments)
    },
  } satisfies ToolDefinition<{
    server: string
    name: string
    arguments?: Record<string, string>
  }>

  return [
    listPromptsTool as ToolDefinition<unknown>,
    getPromptTool as ToolDefinition<unknown>,
  ]
}
