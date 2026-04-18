import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { applyReviewedFileChange } from '@/workspace/file-review.js'
import { t } from '@/i18n/index.js'
import type { ToolDefinition } from './framework.js'
import { resolveToolPath } from '@/workspace/paths.js'
import { applyReplacements } from './search-replace.js'

type Input = {
  path: string
  search: string
  replace: string
  replaceAll?: boolean
}

/** Tool that performs a single exact-text search-and-replace in a file. */
export const editFileTool: ToolDefinition<Input> = {
  name: 'edit_file',
  description: 'Edit a text file by replacing exact text.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      search: { type: 'string' },
      replace: { type: 'string' },
      replaceAll: { type: 'boolean' },
    },
    required: ['path', 'search', 'replace'],
  },
  schema: z.object({
    path: z.string().min(1),
    search: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'write')
    const original = await readFile(target, 'utf8')

    const result = applyReplacements(
      original,
      [{ search: input.search, replace: input.replace, replaceAll: input.replaceAll }],
      input.path,
    )
    if (!result.ok) {
      return {
        ok: false,
        output: t('tool_text_not_found', { path: input.path }),
      }
    }

    return applyReviewedFileChange(context, input.path, target, result.content)
  },
}
