import { z } from 'zod'
import type { PermissionManager } from '@/permissions/manager.js'
import { t } from '@/i18n/index.js'
import type { SkillSummary } from '@/session/skills.js'
import type { McpServerSummary } from '@/mcp/types.js'
import { ToolCache } from '@/tools/tool-cache.js'

/** Execution context passed to every tool invocation. */
export type ToolContext = {
  cwd: string
  permissions?: PermissionManager
  signal?: AbortSignal
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

type ToolRegistryMetadata = {
  skills?: SkillSummary[]
  mcpServers?: McpServerSummary[]
}

/** Container for all available tools, with lookup, execution, and lifecycle management. */
export class ToolRegistry {
  private readonly toolsStore: ToolDefinition<unknown>[]
  private metadataStore: ToolRegistryMetadata
  private readonly disposers: Array<() => Promise<void>> = []
  private readonly cache: ToolCache<ToolResult>

  static readonly READ_ONLY_TOOLS = new Set([
    'list_files',
    'grep_files',
    'read_file',
  ])

  constructor(
    tools: ToolDefinition<unknown>[],
    metadata: ToolRegistryMetadata = {},
    disposer?: () => Promise<void>,
  ) {
    this.toolsStore = [...tools]
    this.metadataStore = metadata
    this.cache = new ToolCache<ToolResult>()
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

  /** Check if a tool is read-only (safe for parallel execution). */
  isReadOnly(toolName: string): boolean {
    return ToolRegistry.READ_ONLY_TOOLS.has(toolName)
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

  clearCache(): void {
    this.cache.clear()
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
      // Check result cache
      const cached = this.cache.get(cacheKey)
      if (cached) return cached

      // Concurrent lookup dedup
      const inflight = this.cache.getInflight(cacheKey)
      if (inflight) return inflight
    }

    const executeInner = async (): Promise<ToolResult> => {
      try {
        const result = await tool.run(parsed.data, context)
        if (cacheKey && result.ok && !result.backgroundTask && !result.awaitUser) {
          this.cache.set(cacheKey, result)
        }
        if (!shouldCache && result.ok) {
          this.cache.invalidateAfterMutation()
        }
        return result
      } catch (error) {
        return {
          ok: false,
          output: error instanceof Error ? error.message : String(error),
        }
      } finally {
        if (cacheKey) {
          this.cache.clearInflight(cacheKey)
        }
      }
    }

    if (cacheKey) {
      const promise = executeInner()
      this.cache.setInflight(cacheKey, promise)
      return promise
    }

    return executeInner()
  }

  async dispose(): Promise<void> {
    await Promise.all(this.disposers.map(disposer => disposer()))
  }
}

// ── Concurrency limiter ──────────────────────────────────────────

type QueuedTask<T> = {
  fn: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/**
 * Simple promise-based semaphore for limiting concurrent operations.
 * Inspired by Effect's concurrency control.
 */
export class ConcurrencyLimiter {
  private running = 0
  private readonly queue: QueuedTask<unknown>[] = []

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running < this.maxConcurrency) {
      this.running += 1
      try {
        return await fn()
      } finally {
        this.running -= 1
        this.drain()
      }
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject })
    })
  }

  private drain(): void {
    if (this.queue.length === 0 || this.running >= this.maxConcurrency) {
      return
    }

    const next = this.queue.shift()!
    this.running += 1
    next.fn().then(
      value => {
        next.resolve(value)
        this.running -= 1
        this.drain()
      },
      error => {
        next.reject(error)
        this.running -= 1
        this.drain()
      },
    )
  }
}
