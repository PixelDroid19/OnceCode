import readline from 'node:readline'
import process from 'node:process'
import { AnthropicModelAdapter } from './agent/anthropic-adapter.js'
import {
  completeSlashCommand,
  findMatchingSlashCommands,
  tryHandleLocalCommand,
} from './commands/handlers.js'
import { compactConversation } from './context/compaction.js'
import { loadRuntimeConfig } from './config/runtime.js'
import { readSettingsFile, ONCECODE_SETTINGS_PATH } from './config/runtime.js'
import { ContextTracker } from './context/tracker.js'
import { initializeI18n, t } from './i18n/index.js'
import { maybeHandleManagementCommand } from './commands/manage.js'
import { summarizeMcpServers } from './mcp/status.js'
import { MockModelAdapter } from './agent/mock-model.js'
import { PermissionManager } from './permissions/manager.js'
import { buildSystemPrompt } from './session/prompt.js'
import { refreshSystemPrompt } from './session/system-prompt.js'
import { createDefaultToolRegistry, hydrateMcpTools } from './tools/index.js'
import { initFrecency, saveFrecency } from './tools/frecency.js'
import type { ChatMessage } from './types.js'
import { renderBanner } from './tui/index.js'
import { runTtyApp } from './tty/app.js'
import { runAgentTurn } from './agent/loop.js'
import type { OnceCodeSettings } from './config/runtime.js'
import { ONCECODE_DIR } from './config/runtime.js'
import { withScope } from './utils/scope.js'

async function main(): Promise<void> {
  await withScope(async scope => {
    const cwd = process.cwd()
    const argv = process.argv.slice(2)
    await initFrecency(ONCECODE_DIR)
    scope.addFinalizer(() => saveFrecency())

    const persistedSettings = await readSettingsFile(ONCECODE_SETTINGS_PATH).catch(
      (): Promise<OnceCodeSettings> => Promise.resolve({}),
    )
    await initializeI18n(persistedSettings.language ?? 'en')

    if (await maybeHandleManagementCommand(cwd, argv)) {
      return
    }

    const isInteractiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY)
    let runtime = null
    try {
      runtime = await loadRuntimeConfig()
    } catch {
      runtime = null
    }

    const tools = await createDefaultToolRegistry({
      cwd,
      runtime,
    })
    const mcpHydration = hydrateMcpTools({
      cwd,
      runtime,
      tools,
    }).catch(() => {
      // Keep startup resilient even if some MCP servers fail.
    })
    const permissions = new PermissionManager(cwd)
    await permissions.whenReady()
    const model =
      process.env.ONCECODE_MODEL_MODE === 'mock'
        ? new MockModelAdapter()
        : new AnthropicModelAdapter(tools, loadRuntimeConfig)
    let messages: ChatMessage[] = [
      {
        role: 'system',
        content: await buildSystemPrompt(cwd, permissions.getSummary(), {
          skills: tools.getSkills(),
          mcpServers: tools.getMcpServers(),
        }),
      },
    ]

    const contextTracker = new ContextTracker(
      runtime?.model ?? 'unknown',
      runtime?.maxOutputTokens,
    )

    try {
      if (isInteractiveTerminal) {
        await runTtyApp({
          runtime,
          tools,
          model,
          messages,
          cwd,
          permissions,
          contextTracker,
        })
        return
      }

      const mcpStatus = summarizeMcpServers(tools.getMcpServers())
      console.log(
        renderBanner(runtime, cwd, permissions.getSummary(), {
          transcriptCount: 0,
          messageCount: messages.length,
          skillCount: tools.getSkills().length,
          mcpTotalCount: mcpStatus.total,
          mcpConnectedCount: mcpStatus.connected,
          mcpConnectingCount: mcpStatus.connecting,
          mcpErrorCount: mcpStatus.error,
          contextUsagePercent: contextTracker.usagePercent,
          contextWarningLevel: contextTracker.warningLevel,
        }),
      )
      console.log('')

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: completeSlashCommand,
      })

      for await (const rawInput of rl) {
        const input = rawInput.trim()
        if (!input) {
          continue
        }
        if (input === '/exit') break

        try {
          if (input === '/tools') {
            console.log(
              `\n${tools.list().map(tool => `${tool.name}: ${tool.description}`).join('\n')}\n`,
            )
            continue
          }

          const localCommandResult = await tryHandleLocalCommand(input, {
            tools,
            contextTracker,
          })
          if (localCommandResult !== null) {
            console.log(`\n${localCommandResult}\n`)
            continue
          }

          if (input.startsWith('/')) {
            const matches = findMatchingSlashCommands(input)
            if (matches.length > 0) {
              console.log(
                `\n${t('cmd_unknown_suggest', {
                  matches: matches.join('\n'),
                })}\n`,
              )
            } else {
              console.log(`\n${t('cmd_unknown')}\n`)
            }
            continue
          }
        } catch (error) {
          console.log(
            `\n${error instanceof Error ? error.message : String(error)}\n`,
          )
          continue
        }

        await refreshSystemPrompt({ messages, cwd, permissions, tools })
        const messagesBeforeUserInput = messages
        messages = [...messages, { role: 'user', content: input }]

        if (
          contextTracker.shouldCompactNextTurn(messages, messagesBeforeUserInput) &&
          contextTracker.canAutoCompact()
        ) {
          try {
            const result = await compactConversation({
              model,
              messages,
            })
            if (result) {
              messages = result.messages
              contextTracker.resetAfterCompaction(result.postCompactTokens)
              console.log(`\n${t('context_auto_compacted')}\n`)
            } else {
              contextTracker.recordCompactFailure()
            }
          } catch {
            contextTracker.recordCompactFailure()
          }
        }

        permissions.beginTurn()
        const turnController = new AbortController()
        try {
          messages = await runAgentTurn({
            model,
            tools,
            messages,
            cwd,
            permissions,
            signal: turnController.signal,
            onUsageUpdate(usage) {
              contextTracker.recordUsage(usage)
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          messages = [
            ...messages,
            {
              role: 'assistant',
              content: t('agent_request_failed', { message }),
            },
          ]
        } finally {
          permissions.endTurn()
        }

        const lastAssistant = [...messages]
          .reverse()
          .find(message => message.role === 'assistant')

        if (lastAssistant?.role === 'assistant') {
          console.log(`\n${lastAssistant.content}\n`)
        }
      }

      try {
        rl.close()
      } catch {
        // Ignore double-close during EOF teardown.
      }
    } finally {
      await mcpHydration
      await tools.dispose()
    }
  })
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
