import { mkdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants.js'
import { readTextFileOrNull } from '@/utils/fs.js'

export type ProviderTransport = 'anthropic' | 'openai' | 'google'

export type ProviderAuth = {
  env: string
  type: 'bearer' | 'header' | 'query'
  name?: string
}

export type ProviderInfo = {
  id: string
  name: string
  transport: ProviderTransport
  defaultBaseUrl: string
  baseUrlEnv: string[]
  modelEnv: string[]
  auth: ProviderAuth[]
  defaultModel: string
}

export type ModelModalities = {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
}

export type ModelCapabilities = {
  attachment: boolean
  reasoning: boolean
  temperature: boolean
  toolCall: boolean
  interleaved: boolean
  input: ModelModalities
  output: ModelModalities
}

export type ModelLimits = {
  context: number
  input?: number
  output: number
}

export type ModelInfo = {
  id: string
  ref: string
  name: string
  api: string
  providerId: string
  family?: string
  aliases: string[]
  defaultOutput: number
  limits: ModelLimits
  capabilities: ModelCapabilities
  known: boolean
}

type SnapshotModel = Omit<ModelInfo, 'ref' | 'providerId' | 'known'>

type SnapshotProvider = ProviderInfo & {
  models: SnapshotModel[]
}

const textOnly = {
  text: true,
  audio: false,
  image: false,
  video: false,
  pdf: false,
} satisfies ModelModalities

const visionIn = {
  text: true,
  audio: false,
  image: true,
  video: false,
  pdf: true,
} satisfies ModelModalities

const toolModel = {
  attachment: true,
  reasoning: false,
  temperature: true,
  toolCall: true,
  interleaved: false,
  input: visionIn,
  output: textOnly,
} satisfies ModelCapabilities

const reasoningModel = {
  ...toolModel,
  reasoning: true,
} satisfies ModelCapabilities

const SNAPSHOT: SnapshotProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    transport: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlEnv: ['ANTHROPIC_BASE_URL'],
    modelEnv: ['ANTHROPIC_MODEL'],
    auth: [
      { env: 'ANTHROPIC_AUTH_TOKEN', type: 'bearer' },
      { env: 'ANTHROPIC_API_KEY', type: 'header', name: 'x-api-key' },
    ],
    defaultModel: 'claude-sonnet-4',
    models: [
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        api: 'claude-opus-4-6',
        family: 'claude-4',
        aliases: ['claude opus 4.6', 'opus-4-6'],
        defaultOutput: 128_000,
        limits: { context: 200_000, output: 128_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        api: 'claude-sonnet-4-6',
        family: 'claude-4',
        aliases: ['claude sonnet 4.6', 'sonnet-4-6'],
        defaultOutput: 64_000,
        limits: { context: 200_000, output: 64_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        api: 'claude-haiku-4-5',
        family: 'claude-4',
        aliases: ['claude haiku 4.5', 'haiku-4-5'],
        defaultOutput: 64_000,
        limits: { context: 200_000, output: 64_000 },
        capabilities: toolModel,
      },
      {
        id: 'claude-opus-4-1',
        name: 'Claude Opus 4.1',
        api: 'claude-opus-4-1',
        family: 'claude-4',
        aliases: ['claude opus 4.1', 'opus-4-1', 'claude-opus-4', 'claude opus 4', 'opus-4'],
        defaultOutput: 32_000,
        limits: { context: 200_000, output: 32_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        api: 'claude-sonnet-4',
        family: 'claude-4',
        aliases: ['claude sonnet 4', 'sonnet-4'],
        defaultOutput: 64_000,
        limits: { context: 200_000, output: 64_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        api: 'claude-3-7-sonnet',
        family: 'claude-3',
        aliases: ['claude 3.7 sonnet', '3-7-sonnet', 'claude-3-7-sonnet-20250219'],
        defaultOutput: 8_192,
        limits: { context: 200_000, output: 8_192 },
        capabilities: reasoningModel,
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        api: 'claude-3-5-sonnet',
        family: 'claude-3',
        aliases: ['claude 3.5 sonnet', '3-5-sonnet', 'claude-3-sonnet', 'claude-3-5-sonnet-20241022'],
        defaultOutput: 8_192,
        limits: { context: 200_000, output: 8_192 },
        capabilities: reasoningModel,
      },
      {
        id: 'claude-3-5-haiku',
        name: 'Claude 3.5 Haiku',
        api: 'claude-3-5-haiku',
        family: 'claude-3',
        aliases: ['claude 3.5 haiku', '3-5-haiku', 'claude-3-5-haiku-20241022'],
        defaultOutput: 8_192,
        limits: { context: 200_000, output: 8_192 },
        capabilities: toolModel,
      },
      {
        id: 'claude-3-opus',
        name: 'Claude 3 Opus',
        api: 'claude-3-opus',
        family: 'claude-3',
        aliases: ['claude 3 opus', 'claude-3-opus-20240229'],
        defaultOutput: 4_096,
        limits: { context: 200_000, output: 4_096 },
        capabilities: toolModel,
      },
      {
        id: 'claude-3-haiku',
        name: 'Claude 3 Haiku',
        api: 'claude-3-haiku',
        family: 'claude-3',
        aliases: ['claude 3 haiku', 'claude-3-haiku-20240307'],
        defaultOutput: 4_096,
        limits: { context: 200_000, output: 4_096 },
        capabilities: toolModel,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    transport: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEnv: ['OPENAI_BASE_URL'],
    modelEnv: ['OPENAI_MODEL'],
    auth: [{ env: 'OPENAI_API_KEY', type: 'bearer' }],
    defaultModel: 'gpt-4o',
    models: [
      {
        id: 'gpt-5-codex',
        name: 'GPT-5 Codex',
        api: 'gpt-5-codex',
        family: 'gpt-5',
        aliases: ['gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5'],
        defaultOutput: 128_000,
        limits: { context: 128_000, output: 128_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'o4-mini',
        name: 'o4-mini',
        api: 'o4-mini',
        family: 'o-series',
        aliases: ['o3', 'o1-pro', 'o1'],
        defaultOutput: 100_000,
        limits: { context: 200_000, output: 100_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        api: 'gpt-4.1',
        family: 'gpt-4.1',
        aliases: ['gpt-4.1-mini', 'gpt-4.1-nano'],
        defaultOutput: 32_768,
        limits: { context: 1_047_576, output: 32_768 },
        capabilities: toolModel,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        api: 'gpt-4o',
        family: 'gpt-4o',
        aliases: ['gpt-4o-mini'],
        defaultOutput: 16_384,
        limits: { context: 128_000, output: 16_384 },
        capabilities: toolModel,
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        api: 'gpt-4-turbo',
        family: 'gpt-4',
        aliases: [],
        defaultOutput: 8_192,
        limits: { context: 128_000, output: 8_192 },
        capabilities: toolModel,
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        api: 'gpt-4',
        family: 'gpt-4',
        aliases: [],
        defaultOutput: 8_192,
        limits: { context: 8_192, output: 8_192 },
        capabilities: toolModel,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    transport: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    baseUrlEnv: ['GOOGLE_BASE_URL', 'GEMINI_BASE_URL'],
    modelEnv: ['GOOGLE_MODEL', 'GEMINI_MODEL'],
    auth: [
      { env: 'GOOGLE_GENERATIVE_AI_API_KEY', type: 'query', name: 'key' },
      { env: 'GEMINI_API_KEY', type: 'query', name: 'key' },
      { env: 'GOOGLE_API_KEY', type: 'query', name: 'key' },
    ],
    defaultModel: 'gemini-2.5-pro',
    models: [
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        api: 'gemini-2.5-pro',
        family: 'gemini-2.5',
        aliases: ['gemini 2.5 pro'],
        defaultOutput: 65_536,
        limits: { context: 1_000_000, output: 65_536 },
        capabilities: reasoningModel,
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        api: 'gemini-2.5-flash',
        family: 'gemini-2.5',
        aliases: ['gemini 2.5 flash'],
        defaultOutput: 65_536,
        limits: { context: 1_000_000, output: 65_536 },
        capabilities: reasoningModel,
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash-Lite',
        api: 'gemini-2.5-flash-lite',
        family: 'gemini-2.5',
        aliases: ['gemini 2.5 flash-lite'],
        defaultOutput: 65_536,
        limits: { context: 1_000_000, output: 65_536 },
        capabilities: reasoningModel,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    transport: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlEnv: ['DEEPSEEK_BASE_URL'],
    modelEnv: ['DEEPSEEK_MODEL'],
    auth: [{ env: 'DEEPSEEK_API_KEY', type: 'bearer' }],
    defaultModel: 'deepseek-chat',
    models: [
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        api: 'deepseek-reasoner',
        family: 'deepseek',
        aliases: [],
        defaultOutput: 32_000,
        limits: { context: 128_000, output: 64_000 },
        capabilities: reasoningModel,
      },
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        api: 'deepseek-chat',
        family: 'deepseek',
        aliases: ['deepseek-coder'],
        defaultOutput: 4_000,
        limits: { context: 128_000, output: 8_000 },
        capabilities: toolModel,
      },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    transport: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    baseUrlEnv: ['GROQ_BASE_URL'],
    modelEnv: ['GROQ_MODEL'],
    auth: [{ env: 'GROQ_API_KEY', type: 'bearer' }],
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile',
        api: 'llama-3.3-70b-versatile',
        family: 'llama',
        aliases: [],
        defaultOutput: 8_192,
        limits: { context: 131_072, output: 8_192 },
        capabilities: toolModel,
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    transport: 'openai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEnv: ['OPENROUTER_BASE_URL'],
    modelEnv: ['OPENROUTER_MODEL'],
    auth: [{ env: 'OPENROUTER_API_KEY', type: 'bearer' }],
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      {
        id: 'openai/gpt-4o-mini',
        name: 'OpenAI GPT-4o Mini',
        api: 'openai/gpt-4o-mini',
        family: 'openrouter',
        aliases: ['openrouter/gpt-4o-mini'],
        defaultOutput: 16_384,
        limits: { context: 128_000, output: 16_384 },
        capabilities: toolModel,
      },
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Anthropic Claude 3.5 Sonnet',
        api: 'anthropic/claude-3.5-sonnet',
        family: 'openrouter',
        aliases: ['openrouter/claude-3.5-sonnet'],
        defaultOutput: 8_192,
        limits: { context: 200_000, output: 8_192 },
        capabilities: reasoningModel,
      },
    ],
  },
]

type Catalog = {
  providers: Map<string, ProviderInfo>
  byProvider: Map<string, Map<string, ModelInfo>>
  byRef: Map<string, ModelInfo>
  byAlias: Map<string, ModelInfo[]>
}

type ApiProvider = Record<string, unknown>

type ApiRoot = Record<string, unknown>

export const ONCECODE_MODELS_PATH = path.join(os.homedir(), '.oncecode', 'models.json')

const MODELS_DEV_URL = process.env.ONCECODE_MODELS_URL?.trim() || 'https://models.dev/api.json'

const TTL = 5 * 60 * 1000

function norm(input: string): string {
  return input.trim().toLowerCase()
}

function ref(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

function add(map: Map<string, ModelInfo[]>, key: string, model: ModelInfo): void {
  const id = norm(key)
  const list = map.get(id) ?? []
  list.push(model)
  map.set(id, list)
}

function copy(input: SnapshotProvider): SnapshotProvider {
  return {
    ...input,
    baseUrlEnv: [...input.baseUrlEnv],
    modelEnv: [...input.modelEnv],
    auth: input.auth.map(item => ({ ...item })),
    models: input.models.map(item => ({
      ...item,
      aliases: [...item.aliases],
      limits: { ...item.limits },
      capabilities: {
        ...item.capabilities,
        input: { ...item.capabilities.input },
        output: { ...item.capabilities.output },
      },
    })),
  }
}

function build(list: SnapshotProvider[]): Catalog {
  const providers = new Map<string, ProviderInfo>()
  const byProvider = new Map<string, Map<string, ModelInfo>>()
  const byRef = new Map<string, ModelInfo>()
  const byAlias = new Map<string, ModelInfo[]>()

  for (const provider of list) {
    const info: ProviderInfo = {
      id: provider.id,
      name: provider.name,
      transport: provider.transport,
      defaultBaseUrl: provider.defaultBaseUrl,
      baseUrlEnv: [...provider.baseUrlEnv],
      modelEnv: [...provider.modelEnv],
      auth: provider.auth.map(item => ({ ...item })),
      defaultModel: provider.defaultModel,
    }
    providers.set(info.id, info)

    const models = new Map<string, ModelInfo>()
    byProvider.set(info.id, models)

    for (const item of provider.models) {
      const model: ModelInfo = {
        ...item,
        providerId: info.id,
        ref: ref(info.id, item.id),
        aliases: [...item.aliases],
        known: true,
      }
      models.set(norm(model.id), model)
      byRef.set(norm(model.ref), model)
      add(byAlias, model.id, model)
      add(byAlias, model.ref, model)
      add(byAlias, model.api, model)
      add(byAlias, model.name, model)
      for (const alias of model.aliases) {
        add(byAlias, alias, model)
      }
    }
  }

  return {
    providers,
    byProvider,
    byRef,
    byAlias,
  }
}

function data(input: unknown): ApiRoot | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  return input as ApiRoot
}

function text(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function num(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null
}

function bool(input: unknown, fallback = false): boolean {
  return typeof input === 'boolean' ? input : fallback
}

function list(input: unknown): string[] {
  if (!Array.isArray(input)) return []

  return input
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

function uniq(input: string[]): string[] {
  return [...new Set(input.filter(Boolean))]
}

function envkey(id: string, suffix: string): string {
  return `${id.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_${suffix}`
}

function mode(input: {
  id: string
  env: string[]
  npm: string
  fallback?: SnapshotProvider
}): ProviderTransport {
  if (input.fallback) return input.fallback.transport
  if (input.id === 'anthropic') return 'anthropic'
  if (input.id === 'google') return 'google'
  if (input.npm.includes('anthropic')) return 'anthropic'
  if (input.npm.includes('google')) return 'google'
  if (
    input.env.some(item =>
      ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'].includes(item),
    )
  ) {
    return 'google'
  }
  return 'openai'
}

function auths(input: {
  id: string
  env: string[]
  mode: ProviderTransport
  fallback?: SnapshotProvider
}): ProviderAuth[] {
  const items = [...(input.fallback?.auth ?? [])]

  for (const env of input.env) {
    if (items.some(item => item.env === env)) continue

    if (input.mode === 'google') {
      items.push({ env, type: 'query', name: 'key' })
      continue
    }

    if (input.mode === 'anthropic' && env.includes('API_KEY')) {
      items.push({ env, type: 'header', name: 'x-api-key' })
      continue
    }

    items.push({ env, type: 'bearer' })
  }

  if (items.length > 0) return items

  if (input.mode === 'google') {
    return [{ env: envkey(input.id, 'API_KEY'), type: 'query', name: 'key' }]
  }

  if (input.mode === 'anthropic') {
    return [{ env: envkey(input.id, 'API_KEY'), type: 'header', name: 'x-api-key' }]
  }

  return [{ env: envkey(input.id, 'API_KEY'), type: 'bearer' }]
}

function mods(
  input: unknown,
  key: 'input' | 'output',
  fallback: ModelModalities,
): ModelModalities {
  const body = data(input)
  const vals = list(body?.[key])
  if (vals.length === 0) return { ...fallback }

  return {
    text: vals.includes('text'),
    audio: vals.includes('audio'),
    image: vals.includes('image'),
    video: vals.includes('video'),
    pdf: vals.includes('pdf'),
  }
}

function caps(input: ApiProvider, fallback?: SnapshotModel): ModelCapabilities {
  const attachment = bool(input.attachment, fallback?.capabilities.attachment ?? false)

  return {
    attachment,
    reasoning: bool(input.reasoning, fallback?.capabilities.reasoning ?? false),
    temperature: bool(input.temperature, fallback?.capabilities.temperature ?? false),
    toolCall: bool(input.tool_call, fallback?.capabilities.toolCall ?? false),
    interleaved:
      typeof input.interleaved === 'boolean'
        ? input.interleaved
        : (fallback?.capabilities.interleaved ?? false),
    input: mods(input.modalities, 'input', fallback?.capabilities.input ?? (attachment ? visionIn : textOnly)),
    output: mods(input.modalities, 'output', fallback?.capabilities.output ?? textOnly),
  }
}

function lims(input: ApiProvider, fallback?: SnapshotModel): ModelLimits {
  const limit = data(input.limit)

  return {
    context: num(limit?.context) ?? fallback?.limits.context ?? DEFAULT_CONTEXT_WINDOW,
    input: num(limit?.input) ?? fallback?.limits.input,
    output: num(limit?.output) ?? fallback?.limits.output ?? fallback?.defaultOutput ?? 32_000,
  }
}

function snapModel(
  providerId: string,
  input: unknown,
  fallback?: SnapshotProvider,
): SnapshotModel | null {
  const body = data(input)
  if (!body) return null

  const id = text(body.id)
  if (!id) return null

  const prev = fallback?.models.find(item => norm(item.id) === norm(id))
  const limit = lims(body, prev)
  const provider = data(body.provider)

  return {
    id,
    name: text(body.name) || prev?.name || id,
    api: text(provider?.api) || id,
    family: text(body.family) || prev?.family,
    aliases: [...(prev?.aliases ?? [])],
    defaultOutput: limit.output,
    limits: limit,
    capabilities: caps(body, prev),
  }
}

function snapProvider(id: string, input: unknown): SnapshotProvider | null {
  const body = data(input)
  if (!body) return null

  const key = text(body.id) || id
  const fallback = SNAPSHOT.find(item => norm(item.id) === norm(key))
  const env = uniq([
    ...list(body.env),
    ...(fallback?.auth.map(item => item.env) ?? []),
  ])
  const npm = text(body.npm)
  const transport = mode({ id: key, env, npm, fallback })
  const raw = data(body.models)
  const models = Object.values(raw ?? {})
    .flatMap(item => {
      const model = snapModel(key, item, fallback)
      return model ? [model] : []
    })

  return {
    id: key,
    name: text(body.name) || fallback?.name || key,
    transport,
    defaultBaseUrl: text(body.api) || fallback?.defaultBaseUrl || '',
    baseUrlEnv: fallback?.baseUrlEnv ? [...fallback.baseUrlEnv] : [envkey(key, 'BASE_URL')],
    modelEnv: fallback?.modelEnv ? [...fallback.modelEnv] : [envkey(key, 'MODEL')],
    auth: auths({ id: key, env, mode: transport, fallback }),
    defaultModel:
      (fallback && models.some(item => norm(item.id) === norm(fallback.defaultModel))
        ? fallback.defaultModel
        : models[0]?.id) ||
      fallback?.defaultModel ||
      '',
    models:
      models.length > 0
        ? models
        : (fallback?.models.map(item => ({
            ...item,
            aliases: [...item.aliases],
            limits: { ...item.limits },
            capabilities: {
              ...item.capabilities,
              input: { ...item.capabilities.input },
              output: { ...item.capabilities.output },
            },
          })) ?? []),
  }
}

function parse(textInput: string): SnapshotProvider[] | null {
  try {
    const root = data(JSON.parse(textInput))
    if (!root) return null

    const items = Object.entries(root)
      .flatMap(([id, value]) => {
        const provider = snapProvider(id, value)
        return provider ? [provider] : []
      })

    if (items.length === 0) return null

    const seen = new Set(items.map(item => norm(item.id)))
    return [...items, ...SNAPSHOT.filter(item => !seen.has(norm(item.id))).map(copy)]
  } catch {
    return null
  }
}

function apply(list: SnapshotProvider[]): void {
  catalog = build(list)
}

async function cache(filePath = ONCECODE_MODELS_PATH): Promise<boolean> {
  const textInput = await readTextFileOrNull(filePath)
  if (!textInput) return false

  const next = parse(textInput)
  if (!next) return false

  apply(next)
  return true
}

async function stale(filePath = ONCECODE_MODELS_PATH): Promise<boolean> {
  const info = await stat(filePath).catch(() => null)
  if (!info) return true
  return Date.now() - info.mtimeMs >= TTL
}

async function pull(): Promise<string | null> {
  if (String(process.env.ONCECODE_DISABLE_MODELS_FETCH ?? '').trim()) {
    return null
  }

  try {
    const result = await fetch(MODELS_DEV_URL, {
      headers: { 'user-agent': 'oncecode' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!result.ok) return null
    return await result.text()
  } catch {
    return null
  }
}

async function save(textInput: string, filePath = ONCECODE_MODELS_PATH): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${textInput.trim()}\n`, 'utf8')
}

let catalog = build(SNAPSHOT)

let ready: Promise<void> | null = null

export async function hydrateCatalog(): Promise<void> {
  if (ready) return ready

  ready = (async () => {
    const hit = await cache()
    if (hit && !(await stale())) return

    const textInput = await pull()
    if (!textInput) return

    const next = parse(textInput)
    if (!next) return

    apply(next)
    await save(textInput)
  })().finally(() => {
    ready = null
  })

  return ready
}

export async function refreshCatalog(force = false): Promise<boolean> {
  if (!force && !(await stale())) {
    return false
  }

  const textInput = await pull()
  if (!textInput) return false

  const next = parse(textInput)
  if (!next) return false

  apply(next)
  await save(textInput)
  return true
}

export function listProviders(): ProviderInfo[] {
  return [...catalog.providers.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function listModels(providerId?: string): ModelInfo[] {
  if (!providerId) {
    return [...catalog.byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref))
  }
  return [...(catalog.byProvider.get(norm(providerId))?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id))
}

export function getProviderInfo(providerId: string): ProviderInfo | null {
  return catalog.providers.get(norm(providerId)) ?? null
}

export function getDefaultModel(providerId: string): ModelInfo | null {
  const provider = getProviderInfo(providerId)
  if (!provider) return null
  return getModelInfo(provider.defaultModel, provider.id)
}

export function parseModelRef(input: string): { providerId: string; modelId: string } | null {
  const trimmed = input.trim()
  const index = trimmed.indexOf(':')
  if (index <= 0 || index === trimmed.length - 1) {
    return null
  }
  return {
    providerId: trimmed.slice(0, index).trim(),
    modelId: trimmed.slice(index + 1).trim(),
  }
}

export function formatModelRef(model: Pick<ModelInfo, 'providerId' | 'id'>): string {
  return ref(model.providerId, model.id)
}

function toEnv(
  env: NodeJS.ProcessEnv | Record<string, string | number | undefined>,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value === undefined ? undefined : String(value)]),
  ) as NodeJS.ProcessEnv
}

export function getConfiguredProviders(
  env: NodeJS.ProcessEnv | Record<string, string | number | undefined> = process.env,
): ProviderInfo[] {
  const source = toEnv(env)
  return listProviders().filter(provider =>
    provider.auth.some(item => String(source[item.env] ?? '').trim()),
  )
}

function pick(
  matches: ModelInfo[],
  env: NodeJS.ProcessEnv | Record<string, string | number | undefined>,
): ModelInfo | null {
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0] ?? null

  const configured = new Set(getConfiguredProviders(env).map(provider => provider.id))
  const preferred = matches.filter(model => configured.has(model.providerId))
  if (preferred.length === 1) return preferred[0] ?? null
  if (preferred.length > 0) return preferred[0] ?? null
  return matches[0] ?? null
}

export function getModelInfo(
  input: string,
  providerId?: string,
  env: NodeJS.ProcessEnv | Record<string, string | number | undefined> = process.env,
): ModelInfo | null {
  const parsed = parseModelRef(input)
  if (parsed) {
    return catalog.byProvider.get(norm(parsed.providerId))?.get(norm(parsed.modelId)) ?? null
  }

  if (providerId) {
    return catalog.byProvider.get(norm(providerId))?.get(norm(input)) ?? pick(catalog.byAlias.get(norm(input))?.filter(model => model.providerId === norm(providerId)) ?? [], env)
  }

  return catalog.byRef.get(norm(input)) ?? pick(catalog.byAlias.get(norm(input)) ?? [], env)
}

export function createUnknownModel(providerId: string, modelId: string): ModelInfo {
  const provider = getProviderInfo(providerId)
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  return {
    id: modelId.trim(),
    ref: ref(provider.id, modelId.trim()),
    name: modelId.trim(),
    api: modelId.trim(),
    providerId: provider.id,
    aliases: [],
    defaultOutput: 32_000,
    limits: {
      context: DEFAULT_CONTEXT_WINDOW,
      output: 64_000,
    },
    capabilities: toolModel,
    known: false,
  }
}

export function inferProvider(
  input?: string,
  env: NodeJS.ProcessEnv | Record<string, string | number | undefined> = process.env,
): ProviderInfo | null {
  const trimmed = String(input ?? '').trim()
  const parsed = parseModelRef(trimmed)
  if (parsed) {
    return getProviderInfo(parsed.providerId)
  }

  const known = trimmed ? getModelInfo(trimmed, undefined, env) : null
  if (known) {
    const provider = getProviderInfo(known.providerId)
    if (provider) return provider
  }

  const configured = getConfiguredProviders(env)
  if (configured.length === 1) {
    return configured[0] ?? null
  }

  return null
}

export function resolveSelection(args: {
  input: string
  providerId?: string
  env?: NodeJS.ProcessEnv | Record<string, string | number | undefined>
}): { provider: ProviderInfo; model: ModelInfo } | null {
  const trimmed = args.input.trim()
  if (!trimmed) return null

  const parsed = parseModelRef(trimmed)
  if (parsed) {
    const provider = getProviderInfo(parsed.providerId)
    if (!provider) return null
    return {
      provider,
      model: getModelInfo(parsed.modelId, provider.id) ?? createUnknownModel(provider.id, parsed.modelId),
    }
  }

  const provider = args.providerId
    ? getProviderInfo(args.providerId)
    : inferProvider(trimmed, args.env)
  if (!provider) return null

  return {
    provider,
    model: getModelInfo(trimmed, provider.id, args.env ?? process.env) ?? createUnknownModel(provider.id, trimmed),
  }
}

export function getProviderLabel(providerId: string): string {
  return getProviderInfo(providerId)?.name ?? providerId
}
