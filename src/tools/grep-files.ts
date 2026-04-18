import { z } from 'zod'
import type { ToolDefinition } from './framework.js'
import { resolveToolPath } from '@/workspace/paths.js'
import { execStreaming } from '@/utils/exec-streaming.js'

type Input = {
  pattern: string
  path?: string
}

/** Default timeout for grep operations (ms). */
const GREP_TIMEOUT_MS = 30_000

/** Max output lines from a single grep. */
const GREP_MAX_LINES = 500

export const grepFilesTool: ToolDefinition<Input> = {
  name: 'grep_files',
  description: 'Search for text in files using ripgrep.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
    required: ['pattern'],
  },
  schema: z.object({
    pattern: z.string().min(1),
    path: z.string().optional(),
  }),
  async run(input, context) {
    const args = ['-n', '--no-heading', input.pattern]
    if (input.path) {
      args.push(await resolveToolPath(context, input.path, 'search'))
    } else {
      args.push('.')
    }

    const result = await execStreaming({
      command: 'rg',
      args,
      cwd: context.cwd,
      timeoutMs: GREP_TIMEOUT_MS,
      maxLines: GREP_MAX_LINES,
      signal: context.signal,
    })

    const output = (result.stdout || result.stderr || '').trim() || '(no matches)'
    const suffix = result.truncated ? '\n... (output truncated)' : ''

    return {
      ok: true,
      output: output + suffix,
    }
  },
}
