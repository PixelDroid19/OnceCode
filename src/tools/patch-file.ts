import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { applyReviewedFileChange } from '../file-review.js'
import { t } from '../i18n/index.js'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'
import { applyReplacements, type Replacement } from './search-replace.js'

type Input = {
  path: string
  replacements: Replacement[]
}

/** Tool that applies multiple search-and-replace operations to a file atomically. */
export const patchFileTool: ToolDefinition<Input> = {
  name: 'patch_file',
  description: 'Apply multiple exact-text replacements to one file in a single operation.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      replacements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            replace: { type: 'string' },
            replaceAll: { type: 'boolean' },
          },
          required: ['search', 'replace'],
        },
      },
    },
    required: ['path', 'replacements'],
  },
  schema: z.object({
    path: z.string().min(1),
    replacements: z.array(
      z.object({
        search: z.string().min(1),
        replace: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    ).min(1),
  }),
  async run(input, context) {
    const target = await resolveToolPath(context, input.path, 'write')
    const original = await readFile(target, 'utf8')

    const result = applyReplacements(original, input.replacements, input.path)
    if (!result.ok) {
      return result.result
    }

    const writeResult = await applyReviewedFileChange(context, input.path, target, result.content)
    if (!writeResult.ok) {
      return writeResult
    }

    return {
      ok: true,
      output: t('tool_patch_applied', {
        path: input.path,
        count: result.applied.length,
        applied: result.applied.join(', '),
      }),
    }
  },
}
