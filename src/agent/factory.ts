import type { RuntimeConfig } from '@/config/runtime.js'
import type { ToolRegistry } from '@/tools/framework.js'
import type { ModelAdapter } from '@/types.js'
import { AnthropicModelAdapter } from '@/agent/anthropic-adapter.js'
import { GoogleModelAdapter } from '@/agent/google-adapter.js'
import { OpenAIModelAdapter } from '@/agent/openai-adapter.js'

export function createModelAdapter(
  tools: ToolRegistry,
  getRuntimeConfig: () => Promise<RuntimeConfig>,
): ModelAdapter {
  return {
    async next(messages, options) {
      const runtime = await getRuntimeConfig()
      if (runtime.provider.transport === 'anthropic') {
        return new AnthropicModelAdapter(tools, getRuntimeConfig).next(messages, options)
      }

      if (runtime.provider.transport === 'google') {
        return new GoogleModelAdapter(tools, getRuntimeConfig).next(messages, options)
      }

      return new OpenAIModelAdapter(tools, getRuntimeConfig).next(messages, options)
    },
  }
}
