/** Token usage reported by the API for a single request. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'assistant_progress'; content: string }
  | {
      role: 'assistant_tool_call'
      toolUseId: string
      toolName: string
      input: unknown
    }
  | {
      role: 'tool_result'
      toolUseId: string
      toolName: string
      content: string
      isError: boolean
    }

export type ToolCall = {
  id: string
  toolName: string
  input: unknown
}

export type StepDiagnostics = {
  stopReason?: string
  blockTypes?: string[]
  ignoredBlockTypes?: string[]
}

export type AgentStep =
  | {
      type: 'assistant'
      content: string
      kind?: 'final' | 'progress'
      diagnostics?: StepDiagnostics
      usage?: TokenUsage
    }
  | {
      type: 'tool_calls'
      calls: ToolCall[]
      content?: string
      contentKind?: 'progress'
      diagnostics?: StepDiagnostics
      usage?: TokenUsage
    }

export interface ModelAdapter {
  next(messages: ChatMessage[]): Promise<AgentStep>
}
