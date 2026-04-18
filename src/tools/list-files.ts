import { z } from 'zod'
import type { ToolDefinition } from './framework.js'
import { resolveToolPath } from '@/workspace/paths.js'
import { searchIndexedFiles } from './file-index.js'

type Input = {
  path?: string
  query?: string
}

export const listFilesTool: ToolDefinition<Input> = {
  name: 'list_files',
  description: 'List files in a directory relative to the workspace root. Optionally rank results with a fuzzy query.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      query: { type: 'string' },
    },
  },
  schema: z.object({
    path: z.string().optional(),
    query: z.string().optional(),
  }),
  async run(input, context) {
    await resolveToolPath(context, input.path ?? '.', 'list')
    const relativeBase = input.path && input.path !== '.' ? input.path : undefined
    const entries = await searchIndexedFiles({
      root: context.cwd,
      relativeBase,
      query: input.query,
    })
    const lines = entries.map(entry => `${entry.kind} ${entry.relativePath}`)

    return {
      ok: true,
      output: lines.join('\n') || '(empty)',
    }
  },
}
