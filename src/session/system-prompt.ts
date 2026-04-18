import { buildSystemPrompt } from './prompt.js'
import type { ToolRegistry } from '@/tools/framework.js'
import type { ChatMessage } from '@/types.js'
import type { PermissionManager } from '@/permissions/manager.js'

/**
 * Rebuild the system prompt (messages[0]) using current tool, skill, and
 * permission state. Both the TTY and non-TTY loops use this so the prompt
 * stays in sync with runtime changes (e.g. MCP tools connected after boot).
 */
export async function refreshSystemPrompt(args: {
  messages: ChatMessage[]
  cwd: string
  permissions: PermissionManager
  tools: ToolRegistry
}): Promise<void> {
  args.messages[0] = {
    role: 'system',
    content: await buildSystemPrompt(args.cwd, args.permissions.getSummary(), {
      skills: args.tools.getSkills(),
      mcpServers: args.tools.getMcpServers(),
    }),
  }
}
