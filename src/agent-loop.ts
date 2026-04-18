import type { ToolRegistry } from './tool.js'
import type { ChatMessage, ModelAdapter } from './types.js'
import type { PermissionManager } from './permissions.js'

function isEmptyAssistantResponse(content: string): boolean {
  return content.trim().length === 0
}

function shouldTreatAssistantAsProgress(args: {
  kind?: 'final' | 'progress'
  content: string
  sawToolResultThisTurn: boolean
}): boolean {
  if (args.kind === 'progress') {
    return true
  }

  if (args.kind === 'final') {
    return false
  }

  if (!args.sawToolResultThisTurn) {
    return false
  }

  return false
}

function formatDiagnostics(args: {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}): string {
  const parts: string[] = []

  if (args.stopReason) {
    parts.push(`stop_reason=${args.stopReason}`)
  }

  if ((args.blockTypes?.length ?? 0) > 0) {
    parts.push(`blocks=${args.blockTypes!.join(',')}`)
  }

  if ((args.ignoredBlockTypes?.length ?? 0) > 0) {
    parts.push(`ignored=${args.ignoredBlockTypes!.join(',')}`)
  }

  return parts.length > 0 ? ` 诊断信息: ${parts.join('; ')}。` : ''
}

function isRecoverableThinkingStop(args: {
  isEmpty: boolean
  stopReason?: string
  ignoredBlockTypes?: string[]
}): boolean {
  if (!args.isEmpty) {
    return false
  }

  if (args.stopReason !== 'pause_turn' && args.stopReason !== 'max_tokens') {
    return false
  }

  return (args.ignoredBlockTypes ?? []).includes('thinking')
}

/** Drives the model in a loop, executing tool calls until the agent yields a final response. */
export async function runAgentTurn(args: {
  model: ModelAdapter
  tools: ToolRegistry
  messages: ChatMessage[]
  cwd: string
  permissions?: PermissionManager
  maxSteps?: number
  onToolStart?: (toolName: string, input: unknown) => void
  onToolResult?: (toolName: string, output: string, isError: boolean) => void
  onAssistantMessage?: (content: string) => void
  onProgressMessage?: (content: string) => void
}): Promise<ChatMessage[]> {
  const maxSteps = args.maxSteps
  let messages = args.messages
  let emptyResponseRetryCount = 0
  let recoverableThinkingRetryCount = 0
  let toolErrorCount = 0
  let sawToolResultThisTurn = false

  const pushContinuationPrompt = (content: string) => {
    messages = [
      ...messages,
      {
        role: 'user',
        content,
      },
    ]
  }

  for (let step = 0; maxSteps == null || step < maxSteps; step++) {
    const next = await args.model.next(messages)

    if (next.type === 'assistant') {
      const isEmpty = isEmptyAssistantResponse(next.content)
      if (
        !isEmpty &&
        shouldTreatAssistantAsProgress({
          kind: next.kind,
          content: next.content,
          sawToolResultThisTurn,
        })
      ) {
        args.onProgressMessage?.(next.content)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: next.content },
        ]
        pushContinuationPrompt(
          sawToolResultThisTurn && next.kind !== 'progress'
            ? 'Continue from your progress update. You have already used tools in this turn, so treat plain status text as progress, not a final answer. Respond with the next concrete tool call, code change, or an explicit <final> answer only if the task is truly complete.'
            : 'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (
        isRecoverableThinkingStop({
          isEmpty,
          stopReason: next.diagnostics?.stopReason,
          ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
        }) &&
        recoverableThinkingRetryCount < 3
      ) {
        recoverableThinkingRetryCount += 1
        const stopReason = next.diagnostics?.stopReason
        const progressContent =
          stopReason === 'max_tokens'
            ? '模型在 thinking 阶段触发 max_tokens，正在继续请求后续步骤...'
            : '模型返回 pause_turn，正在继续请求后续步骤...'
        args.onProgressMessage?.(progressContent)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: progressContent },
        ]
        pushContinuationPrompt(
          stopReason === 'max_tokens'
            ? 'Your previous response hit max_tokens during thinking before producing the next actionable step. Resume immediately and continue with the next concrete tool call, code change, or an explicit <final> answer only if the task is complete. Do not repeat the earlier plan.'
            : 'Resume from the previous pause_turn and continue the task immediately. Produce the next concrete tool call, code change, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (isEmpty && emptyResponseRetryCount < 2) {
        emptyResponseRetryCount += 1
        pushContinuationPrompt(
          sawToolResultThisTurn
            ? 'Your last response was empty after recent tool results. Continue immediately by trying the next concrete step, adapting to any tool errors, or giving an explicit <final> answer only if the task is complete.'
            : 'Your last response was empty. Continue immediately with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
        continue
      }

      if (isEmpty) {
        const diagnosticsSuffix = formatDiagnostics({
          stopReason: next.diagnostics?.stopReason,
          blockTypes: next.diagnostics?.blockTypes,
          ignoredBlockTypes: next.diagnostics?.ignoredBlockTypes,
        })
        const fallbackContent =
          sawToolResultThisTurn
            ? toolErrorCount > 0
              ? `工具执行后模型返回空响应，已停止当前回合。最近有 ${toolErrorCount} 个工具报错；请重试、调整命令，或让模型改用其他方案。${diagnosticsSuffix}`
              : `工具执行后模型返回空响应，已停止当前回合。请重试，或要求模型继续完成剩余步骤。${diagnosticsSuffix}`
            : `模型返回空响应，已停止当前回合。请重试，或要求模型继续。${diagnosticsSuffix}`

        args.onAssistantMessage?.(fallbackContent)
        return [
          ...messages,
          {
            role: 'assistant',
            content: fallbackContent,
          },
        ]
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: next.content,
      }
      const withAssistant: ChatMessage[] = [
        ...messages,
        assistantMessage,
      ]

      if (!isEmpty) {
        args.onAssistantMessage?.(next.content)
      }

      return withAssistant
    }

    if (next.content) {
      if (next.contentKind === 'progress') {
        args.onProgressMessage?.(next.content)
        messages = [
          ...messages,
          { role: 'assistant_progress', content: next.content },
        ]
        pushContinuationPrompt(
          'Continue immediately from your <progress> update with concrete tool calls, code changes, or an explicit <final> answer only if the task is complete.',
        )
      } else {
        args.onAssistantMessage?.(next.content)
        messages = [
          ...messages,
          { role: 'assistant', content: next.content },
        ]
      }
    }

    if ((next.calls?.length ?? 0) === 0 && next.content && next.contentKind !== 'progress') {
      return messages
    }

    for (const call of next.calls) {
      args.onToolStart?.(call.toolName, call.input)
      const result = await args.tools.execute(
        call.toolName,
        call.input,
        { cwd: args.cwd, permissions: args.permissions },
      )
      sawToolResultThisTurn = true
      if (!result.ok) {
        toolErrorCount += 1
      }
      args.onToolResult?.(call.toolName, result.output, !result.ok)

      messages = [
        ...messages,
        {
          role: 'assistant_tool_call',
          toolUseId: call.id,
          toolName: call.toolName,
          input: call.input,
        },
        {
          role: 'tool_result',
          toolUseId: call.id,
          toolName: call.toolName,
          content: result.output,
          isError: !result.ok,
        },
      ]

      if (result.awaitUser) {
        const question = result.output.trim()
        if (question.length > 0) {
          args.onAssistantMessage?.(question)
          messages = [
            ...messages,
            {
              role: 'assistant',
              content: question,
            },
          ]
        }
        return messages
      }
    }
  }

  const maxStepContent = `达到最大工具步数限制，已停止当前回合。`
  args.onAssistantMessage?.(maxStepContent)
  return [
    ...messages,
    {
      role: 'assistant',
      content: maxStepContent,
    },
  ]
}
