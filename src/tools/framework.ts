import { z } from 'zod'
import type { PermissionManager } from '@/permissions/manager.js'
import { t } from '@/i18n/index.js'
import type { SkillSummary } from '@/session/skills.js'
import type { McpServerSummary } from '@/mcp/types.js'

/** Execution context passed to every tool invocation. */
export type ToolContext = {
  cwd: string
  permissions?: PermissionManager
}

/** Metadata for a command launched in the background (e.g. trailing `&`). */
export type BackgroundTaskResult = {
  taskId: string
  type: 'local_bash'
  command: string
  pid: number
  status: 'running' | 'completed' | 'failed'
  startedAt: number
}

/** Standardized result returned by all tool implementations. */
export type ToolResult = {
  ok: boolean
  output: string
  backgroundTask?: BackgroundTaskResult
  awaitUser?: boolean
}

/** Schema-validated tool with name, description, and run function. */
export type ToolDefinition<TInput> = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  schema: z.ZodType<TInput>
  run(input: TInput, context: ToolContext): Promise<ToolResult>
}

type CachedToolEntry = {
  result: ToolResult
  createdAt: number
}

type ToolRegistryMetadata = {
  skills?: SkillSummary[]
  mcpServers?: McpServerSummary[]
}

/** Container for all available tools, with lookup, execution, and lifecycle management. */
export class ToolRegistry {
  private readonly toolsStore: ToolDefinition<unknown>[]
  private metadataStore: ToolRegistryMetadata
  private readonly disposers: Array<() => Promise<void>> = []
  private readonly resultCache = new Map<string, CachedToolEntry>()

  private static readonly READ_ONLY_TOOLS = new Set([
    'list_files',
    'grep_files',
    'read_file',
  ])

  private static readonly CACHE_TTL_MS = 2_000
  private static readonly MAX_CACHE_ENTRIES = 64

  constructor(
    tools: ToolDefinition<unknown>[],
    metadata: ToolRegistryMetadata = {},
    disposer?: () => Promise<void>,
  ) {
    this.toolsStore = [...tools]
    this.metadataStore = metadata
    if (disposer) {
      this.disposers.push(disposer)
    }
  }

  list(): ToolDefinition<unknown>[] {
    return this.toolsStore
  }

  getSkills(): SkillSummary[] {
    return this.metadataStore.skills ?? []
  }

  getMcpServers(): McpServerSummary[] {
    return this.metadataStore.mcpServers ?? []
  }

  setMcpServers(servers: McpServerSummary[]): void {
    this.metadataStore = {
      ...this.metadataStore,
      mcpServers: [...servers],
    }
  }

  addTools(nextTools: ToolDefinition<unknown>[]): void {
    const existingNames = new Set(this.toolsStore.map(tool => tool.name))
    for (const tool of nextTools) {
      if (existingNames.has(tool.name)) {
        continue
      }
      this.toolsStore.push(tool)
      existingNames.add(tool.name)
    }
  }

  addDisposer(disposer: () => Promise<void>): void {
    this.disposers.push(disposer)
  }

  find(name: string): ToolDefinition<unknown> | undefined {
    return this.toolsStore.find(tool => tool.name === name)
  }

  private createCacheKey(
    toolName: string,
    input: unknown,
    context: ToolContext,
  ): string {
    return JSON.stringify({
      toolName,
      cwd: context.cwd,
      input,
    })
  }

  private getCachedResult(key: string): ToolResult | null {
    const cached = this.resultCache.get(key)
    if (!cached) {
      return null
    }

    if (Date.now() - cached.createdAt > ToolRegistry.CACHE_TTL_MS) {
      this.resultCache.delete(key)
      return null
    }

    return cached.result
  }

  private setCachedResult(key: string, result: ToolResult): void {
    this.resultCache.set(key, {
      result,
      createdAt: Date.now(),
    })

    if (this.resultCache.size <= ToolRegistry.MAX_CACHE_ENTRIES) {
      return
    }

    const oldestKey = this.resultCache.keys().next().value
    if (oldestKey) {
      this.resultCache.delete(oldestKey)
    }
  }

  clearCache(): void {
    this.resultCache.clear()
  }

  async execute(
    toolName: string,
    input: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.find(toolName)
    if (!tool) {
      return {
        ok: false,
        output: t('tool_unknown', { toolName }),
      }
    }

    const parsed = tool.schema.safeParse(input)
    if (!parsed.success) {
      return {
        ok: false,
        output: parsed.error.message,
      }
    }

    const shouldCache = ToolRegistry.READ_ONLY_TOOLS.has(toolName)
    const cacheKey = shouldCache
      ? this.createCacheKey(toolName, parsed.data, context)
      : null

    if (cacheKey) {
      const cached = this.getCachedResult(cacheKey)
      if (cached) {
        return cached
      }
    }

    try {
      const result = await tool.run(parsed.data, context)
      if (cacheKey && result.ok && !result.backgroundTask && !result.awaitUser) {
        this.setCachedResult(cacheKey, result)
      }
      return result
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(this.disposers.map(disposer => disposer()))
  }
}
