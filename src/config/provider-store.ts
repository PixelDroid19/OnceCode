import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readTextFileOrNull } from '@/utils/fs.js'

export type ProviderConnection = {
  providerId: string
  vars?: Record<string, string>
  baseUrl?: string
  model?: string
  connectedAt?: string
}

export type ProviderState = {
  activeProvider?: string
  activeModel?: string
  providers?: Record<string, ProviderConnection>
}

export const ONCECODE_PROVIDERS_PATH = path.join(os.homedir(), '.oncecode', 'providers.json')

function normalize(input: ProviderState): ProviderState {
  const providers = Object.fromEntries(
    Object.entries(input.providers ?? {}).map(([key, value]) => [
      key,
      {
        providerId: value.providerId || key,
        vars: value.vars ?? {},
        baseUrl: value.baseUrl,
        model: value.model,
        connectedAt: value.connectedAt,
      },
    ]),
  )

  return {
    activeProvider: input.activeProvider,
    activeModel: input.activeModel,
    providers,
  }
}

export async function readProviderState(
  filePath = ONCECODE_PROVIDERS_PATH,
): Promise<ProviderState> {
  const content = await readTextFileOrNull(filePath)
  if (!content) {
    return { providers: {} }
  }

  try {
    const parsed = JSON.parse(content) as ProviderState
    return normalize(parsed)
  } catch {
    return { providers: {} }
  }
}

export async function saveProviderState(
  state: ProviderState,
  filePath = ONCECODE_PROVIDERS_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(normalize(state), null, 2)}\n`, 'utf8')
}

export async function saveProviderConnection(args: {
  providerId: string
  vars?: Record<string, string>
  baseUrl?: string
  model?: string
  activate?: boolean
  filePath?: string
}): Promise<ProviderState> {
  const state = await readProviderState(args.filePath)
  const providers = {
    ...(state.providers ?? {}),
    [args.providerId]: {
      providerId: args.providerId,
      vars: {
        ...((state.providers ?? {})[args.providerId]?.vars ?? {}),
        ...(args.vars ?? {}),
      },
      baseUrl: args.baseUrl ?? (state.providers ?? {})[args.providerId]?.baseUrl,
      model: args.model ?? (state.providers ?? {})[args.providerId]?.model,
      connectedAt: new Date().toISOString(),
    },
  }
  const next: ProviderState = {
    activeProvider: args.activate === false ? state.activeProvider : args.providerId,
    activeModel: args.activate === false ? state.activeModel : (args.model ?? state.activeModel),
    providers,
  }
  await saveProviderState(next, args.filePath)
  return next
}

export async function setActiveProviderSelection(args: {
  providerId: string
  model?: string
  filePath?: string
}): Promise<ProviderState> {
  const state = await readProviderState(args.filePath)
  const next: ProviderState = {
    ...state,
    activeProvider: args.providerId,
    activeModel: args.model ?? state.activeModel,
  }
  if (args.model && next.providers?.[args.providerId]) {
    next.providers = {
      ...next.providers,
      [args.providerId]: {
        ...next.providers[args.providerId]!,
        model: args.model,
      },
    }
  }
  await saveProviderState(next, args.filePath)
  return next
}

export async function removeProviderConnection(
  providerId: string,
  filePath = ONCECODE_PROVIDERS_PATH,
): Promise<ProviderState> {
  const state = await readProviderState(filePath)
  const providers = { ...(state.providers ?? {}) }
  delete providers[providerId]
  const next: ProviderState = {
    activeProvider: state.activeProvider === providerId ? undefined : state.activeProvider,
    activeModel:
      state.activeProvider === providerId
        ? undefined
        : state.activeModel,
    providers,
  }
  await saveProviderState(next, filePath)
  return next
}
