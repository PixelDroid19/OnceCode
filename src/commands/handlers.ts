import {
  ONCECODE_PROVIDERS_PATH,
  ONCECODE_MCP_PATH,
  ONCECODE_PERMISSIONS_PATH,
  ONCECODE_SETTINGS_PATH,
  describeRuntimeModel,
  loadRuntimeConfig,
  saveOnceCodeSettings,
  type RuntimeConfig,
} from '@/config/runtime.js'
import {
  readProviderState,
  saveProviderConnection,
  setActiveProviderSelection,
} from '@/config/provider-store.js'
import type { ContextTracker } from '@/context/tracker.js'
import {
  getCurrentLanguageLabel,
  setLanguage,
  t,
} from '@/i18n/index.js'
import {
  formatLanguageDisplay,
  getSupportedLanguageIds,
  normalizeLanguageInput,
  type LanguageSetting,
  resolveLanguage,
} from '@/i18n/languages.js'
import {
  formatModelRef,
  getProviderInfo,
  listModels,
  resolveSelection,
  type ModelInfo,
} from '@/provider/catalog.js'
import type { ToolRegistry } from '@/tools/framework.js'

/** Definition of a user-facing slash command available in the REPL. */
export type SlashCommand = {
  name: string
  usage: string
  description: string
}

type SlashCommandDefinition = {
  name: string
  usage: string
  descriptionKey: string
}

const SLASH_COMMAND_DEFINITIONS: readonly SlashCommandDefinition[] = [
  {
    name: '/help',
    usage: '/help',
    descriptionKey: 'cmd_help_desc',
  },
  {
    name: '/tools',
    usage: '/tools',
    descriptionKey: 'cmd_tools_desc',
  },
  {
    name: '/status',
    usage: '/status',
    descriptionKey: 'cmd_config_desc',
  },
  {
    name: '/model',
    usage: '/model',
    descriptionKey: 'cmd_model_show_desc',
  },
  {
    name: '/model',
    usage: '/model <model-name>',
    descriptionKey: 'cmd_model_set_desc',
  },
  {
    name: '/connect',
    usage: '/connect',
    descriptionKey: 'cmd_connect_desc',
  },
  {
    name: '/providers',
    usage: '/providers',
    descriptionKey: 'cmd_providers_desc',
  },
  {
    name: '/config-paths',
    usage: '/config-paths',
    descriptionKey: 'cmd_paths_desc',
  },
  {
    name: '/skills',
    usage: '/skills',
    descriptionKey: 'cmd_skills_desc',
  },
  {
    name: '/mcp',
    usage: '/mcp',
    descriptionKey: 'cmd_mcp_desc',
  },
  {
    name: '/permissions',
    usage: '/permissions',
    descriptionKey: 'cmd_permissions_desc',
  },
  {
    name: '/language',
    usage: '/language [en-US|es-ES|auto]',
    descriptionKey: 'cmd_language_desc',
  },
  {
    name: '/context',
    usage: '/context',
    descriptionKey: 'cmd_context_desc',
  },
  {
    name: '/compact',
    usage: '/compact',
    descriptionKey: 'cmd_compact_desc',
  },
  {
    name: '/exit',
    usage: '/exit',
    descriptionKey: 'cmd_exit_desc',
  },
  {
    name: '/ls',
    usage: '/ls [path]',
    descriptionKey: 'cmd_ls_desc',
  },
  {
    name: '/grep',
    usage: '/grep <pattern>::[path]',
    descriptionKey: 'cmd_grep_desc',
  },
  {
    name: '/read',
    usage: '/read <path>',
    descriptionKey: 'cmd_read_desc',
  },
  {
    name: '/write',
    usage: '/write <path>::<content>',
    descriptionKey: 'cmd_write_desc',
  },
  {
    name: '/modify',
    usage: '/modify <path>::<content>',
    descriptionKey: 'cmd_review_desc',
  },
  {
    name: '/edit',
    usage: '/edit <path>::<search>::<replace>',
    descriptionKey: 'cmd_edit_desc',
  },
  {
    name: '/patch',
    usage: '/patch <path>::<search1>::<replace1>::<search2>::<replace2>...',
    descriptionKey: 'cmd_patch_desc',
  },
  {
    name: '/cmd',
    usage: '/cmd [cwd::]<command> [args...]',
    descriptionKey: 'cmd_run_desc',
  },
] as const

function buildSlashCommands(): SlashCommand[] {
  return SLASH_COMMAND_DEFINITIONS.map(command => ({
    name: command.name,
    usage: command.usage,
    description: t(command.descriptionKey),
  }))
}

/** Returns the current translated slash-command list. */
export function getSlashCommands(): SlashCommand[] {
  return buildSlashCommands()
}

/** Formats all slash commands into a human-readable help listing. */
export function formatSlashCommands(): string {
  return buildSlashCommands()
    .map(command => `${command.usage}  ${command.description}`)
    .join('\n')
}

/** Returns slash command usage strings that match the given prefix for autocompletion. */
export function findMatchingSlashCommands(input: string): string[] {
  return buildSlashCommands()
    .map(command => command.usage)
    .filter(command => command.startsWith(input))
}

async function handleLanguageCommand(input: string): Promise<string> {
  const rawValue = input.slice('/language'.length).trim()
  if (!rawValue) {
    return [
      t('lang_current', {
        lang: getCurrentLanguageLabel(),
      }),
      t('lang_available', {
        options: `${getSupportedLanguageIds(', ')}, auto`,
      }),
      t('lang_usage', {
        options: getSupportedLanguageIds('|'),
      }),
    ].join('\n')
  }

  const normalizedSetting: LanguageSetting | null =
    rawValue.toLowerCase() === 'auto'
      ? 'auto'
      : normalizeLanguageInput(rawValue)

  if (!normalizedSetting) {
    return t('lang_invalid', {
      options: `${getSupportedLanguageIds(', ')}, auto`,
    })
  }

  await saveOnceCodeSettings({ language: normalizedSetting })
  await setLanguage(normalizedSetting)

  return t('lang_changed', {
    lang:
      normalizedSetting === 'auto'
        ? formatLanguageDisplay(resolveLanguage('auto'))
        : formatLanguageDisplay(normalizedSetting),
  })
}

function formatModelChoices(models: ModelInfo[]): string {
  return models
    .slice(0, 24)
    .map(model => `- ${formatModelRef(model)}  ${model.name}`)
    .join('\n')
}

async function formatProviders(runtime: RuntimeConfig): Promise<string> {
  const state = await readProviderState()
  const ids = [...new Set(
    Object.values(state.providers ?? {})
      .map(item => item.providerId.trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b))

  return [
    t('config_provider', { provider: runtime.provider?.name ?? 'custom' }),
    t('config_model', { model: describeRuntimeModel(runtime) }),
    t('config_connected_providers', { count: ids.length }),
    ids.length > 0
      ? ids
          .map(id => `- ${id}${id === runtime.provider.id ? ' *' : ''}  ${getProviderInfo(id)?.name ?? id}`)
          .join('\n')
      : t('config_no_connected_providers'),
    t('config_providers_path', { path: ONCECODE_PROVIDERS_PATH }),
  ].join('\n')
}

async function handleModelCommand(args: {
  input: string
  runtime?: RuntimeConfig | null
  onRuntimeChange?: (runtime: RuntimeConfig) => Promise<void> | void
}): Promise<string> {
  if (args.input === '/model') {
    const runtime = args.runtime ?? await loadRuntimeConfig()
    return [
      t('config_current_model', { model: describeRuntimeModel(runtime) }),
      t('config_provider', { provider: runtime.provider?.name ?? 'custom' }),
    ].join('\n')
  }

  const raw = args.input.slice('/model '.length).trim()
  if (!raw) {
    return t('config_model_usage')
  }

  const runtime = args.runtime ?? await loadRuntimeConfig().then(
    value => value,
    () => null,
  )
  const provider = runtime?.provider.id ? getProviderInfo(runtime.provider.id) : null
  const typed = raw.includes(':') ? raw : provider?.id ? `${provider.id}:${raw}` : raw
  const resolved = resolveSelection({
    input: typed,
    providerId: provider?.id,
    env: {
      ...(process.env as Record<string, string | undefined>),
    },
  })

  if (!resolved) {
    const hint = provider ? formatModelChoices(listModels(provider.id)) : formatModelChoices(listModels())
    return [
      t('config_model_invalid', { model: raw }),
      hint,
    ].filter(Boolean).join('\n')
  }

  const ref = formatModelRef(resolved.model)
  await setActiveProviderSelection({
    providerId: resolved.provider.id,
    model: ref,
  })
  if ((await readProviderState()).providers?.[resolved.provider.id]) {
    await saveProviderConnection({
      providerId: resolved.provider.id,
      model: ref,
      activate: false,
    })
  }
  const next = await loadRuntimeConfig()
  await args.onRuntimeChange?.(next)
  const saved = raw.includes(':') ? describeRuntimeModel(next) : raw
  return t('config_model_saved', {
    model: saved,
    path: ONCECODE_PROVIDERS_PATH,
  })
}

/** Attempts to handle a slash command locally; returns null if the input is not a recognized command. */
export async function tryHandleLocalCommand(
  input: string,
  context?: {
    tools?: ToolRegistry
    contextTracker?: ContextTracker
    runtime?: RuntimeConfig | null
    onRuntimeChange?: (runtime: RuntimeConfig) => Promise<void> | void
  },
): Promise<string | null> {
  if (input === '/' || input === '/help') {
    return formatSlashCommands()
  }

  if (input === '/config-paths') {
    return [
      t('config_settings_path', { path: ONCECODE_SETTINGS_PATH }),
      t('config_providers_path', { path: ONCECODE_PROVIDERS_PATH }),
      t('config_permissions_path', { path: ONCECODE_PERMISSIONS_PATH }),
      t('config_mcp_path', { path: ONCECODE_MCP_PATH }),
    ].join('\n')
  }

  if (input === '/providers') {
    const runtime = context?.runtime ?? await loadRuntimeConfig()
    return formatProviders(runtime)
  }

  if (input === '/connect') {
    return t('config_connect_tty')
  }

  if (input === '/permissions') {
    return t('config_permission_store', { path: ONCECODE_PERMISSIONS_PATH })
  }

  if (input === '/skills') {
    const skills = context?.tools?.getSkills() ?? []
    if (skills.length === 0) {
      return t('skill_none_with_hint', {
        locations:
          '~/.oncecode/skills/<name>/SKILL.md or .oncecode/skills/<name>/SKILL.md',
      })
    }

    return skills
      .map(skill => `${skill.name}  ${skill.description}  [${skill.source}]`)
      .join('\n')
  }

  if (input === '/mcp') {
    const servers = context?.tools?.getMcpServers() ?? []
    if (servers.length === 0) {
      return t(
        'mcp_no_servers',
      )
    }

    return servers
      .map(server => {
        const suffix = server.error ? `  error=${server.error}` : ''
        const protocol = server.protocol ? `  protocol=${server.protocol}` : ''
        const resources =
          server.resourceCount !== undefined
            ? `  resources=${server.resourceCount}`
            : ''
        const prompts =
          server.promptCount !== undefined
            ? `  prompts=${server.promptCount}`
            : ''
        return `${server.name}  status=${server.status}  tools=${server.toolCount}${resources}${prompts}${protocol}${suffix}`
      })
      .join('\n')
  }

  if (input === '/status') {
    const runtime = context?.runtime ?? await loadRuntimeConfig()
    return [
      t('config_model', { model: describeRuntimeModel(runtime) }),
      t('config_provider', { provider: runtime.provider?.name ?? 'custom' }),
      t('config_base_url', { baseUrl: runtime.provider?.baseUrl ?? String((runtime as RuntimeConfig & { baseUrl?: string }).baseUrl ?? '') }),
      t('config_auth', {
        auth: runtime.provider?.auth.env ?? 'unknown',
      }),
      t('config_mcp_count', {
        count: Object.keys(runtime.mcpServers).length,
      }),
      runtime.sourceSummary,
    ].join('\n')
  }

  if (input === '/model' || input.startsWith('/model ')) {
    return handleModelCommand({
      input,
      runtime: context?.runtime,
      onRuntimeChange: context?.onRuntimeChange,
    })
  }

  if (input === '/language' || input.startsWith('/language ')) {
    return handleLanguageCommand(input)
  }

  if (input === '/context') {
    const tracker = context?.contextTracker
    if (!tracker) {
      return t('context_not_available')
    }
    return tracker.formatSummary()
  }

  // /compact is handled specially in tty-app.ts (needs model adapter)
  // Return a hint if reached here (non-TTY mode)
  if (input === '/compact') {
    return t('context_compact_hint')
  }

  return null
}

export function completeSlashCommand(line: string): [string[], string] {
  const commands = buildSlashCommands()
  const hits = commands
    .map(command => command.usage)
    .filter(command => command.startsWith(line))

  return [
    hits.length > 0 ? hits : commands.map(command => command.usage),
    line,
  ]
}
