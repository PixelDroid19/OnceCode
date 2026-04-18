import { z } from 'zod'
import { applyReviewedFileChange } from '../file-review.js'
import type { ToolDefinition } from '../tool.js'
import { resolveToolPath } from '../workspace.js'

type WholeFileInput = {
  path: string
  content: string
}

const wholeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})

const wholeFileInputSchema = {
  type: 'object' as const,
  properties: {
    path: { type: 'string' as const },
    content: { type: 'string' as const },
  },
  required: ['path', 'content'] as const,
}

async function runWholeFileWrite(
  input: WholeFileInput,
  context: { cwd: string },
) {
  const target = await resolveToolPath(context, input.path, 'write')
  return applyReviewedFileChange(context, input.path, target, input.content)
}

/** Tool that creates or overwrites a file with the given content. */
export const writeFileTool: ToolDefinition<WholeFileInput> = {
  name: 'write_file',
  description: 'Write a UTF-8 text file relative to the workspace root.',
  inputSchema: wholeFileInputSchema,
  schema: wholeFileSchema,
  run: runWholeFileWrite,
}

/** Tool alias that shows a diff for user approval before writing. */
export const modifyFileTool: ToolDefinition<WholeFileInput> = {
  name: 'modify_file',
  description: 'Replace a file with reviewed content so the user can approve the diff first.',
  inputSchema: wholeFileInputSchema,
  schema: wholeFileSchema,
  run: runWholeFileWrite,
}
