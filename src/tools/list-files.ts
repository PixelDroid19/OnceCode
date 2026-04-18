import { readdir } from 'node:fs/promises'
import { z } from 'zod'
import { MAX_LIST_FILES_RESULTS } from '@/constants.js'
import type { ToolDefinition } from './framework.js'
import { resolveToolPath } from '@/workspace/paths.js'

type Input = {
  path?: string
}

export const listFilesTool: ToolDefinition<Input> = {
  name: 'list_files',
  description: 'List files in a directory relative to the workspace root.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
    },
  },
  schema: z.object({
    path: z.string().optional(),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path ?? '.', 'list')
    const entries = await readdir(target, { withFileTypes: true })
    const lines = entries
      .slice(0, MAX_LIST_FILES_RESULTS)
      .map(entry => `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}`)

    return {
      ok: true,
      output: lines.join('\n') || '(empty)',
    }
  },
}
