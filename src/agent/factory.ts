/**
 * Model adapter factory.
 *
 * Creates a unified `ModelAdapter` that dispatches to the correct
 * provider-specific adapter (Anthropic, Google, or OpenAI) based on
 * `RuntimeConfig.provider.transport`. Adapter instances are cached for
 * the lifetime of the returned adapter.
 */

import type { RuntimeConfig } from '@/config/runtime.js'
import type { ToolRegistry } from '@/tools/framework.js'
import type { ModelAdapter } from '@/types.js'
import { AnthropicModelAdapter } from '@/agent/anthropic-adapter.js'
import { GoogleModelAdapter } from '@/agent/google-adapter.js'
import { OpenAIModelAdapter } from '@/agent/openai-adapter.js'

/**
 * Creates a transport-dispatching `ModelAdapter` that routes each `next()`
 * call to the adapter matching `runtime.provider.transport`.
 */
export function createModelAdapter(
  tools: ToolRegistry,
  getRuntimeConfig: () => Promise<RuntimeConfig>,
): ModelAdapter {
  const adapters = {
    anthropic: new AnthropicModelAdapter(tools, getRuntimeConfig),
    google: new GoogleModelAdapter(tools, getRuntimeConfig),
    openai: new OpenAIModelAdapter(tools, getRuntimeConfig),
  }

  return {
    async next(messages, options) {
      const runtime = await getRuntimeConfig()
      if (runtime.provider.transport === 'anthropic') {
        return adapters.anthropic.next(messages, options)
      }

      if (runtime.provider.transport === 'google') {
        return adapters.google.next(messages, options)
      }

      return adapters.openai.next(messages, options)
    },
  }
}
