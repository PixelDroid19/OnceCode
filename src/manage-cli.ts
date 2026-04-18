import {
  type McpConfigScope,
  type McpServerConfig,
  ONCECODE_MCP_TOKENS_PATH,
  getMcpConfigPath,
  loadScopedMcpServers,
  readMcpTokensFile,
  saveMcpTokensFile,
  saveScopedMcpServers,
} from './config.js'
import { discoverSkills, installSkill, removeManagedSkill } from './skills.js'
import { t } from './i18n/index.js'

function printUsage(): void {
  console.log(`${t('manage_description')}

oncecode mcp list [--project]
oncecode mcp add <name> [--project] [--protocol <auto|content-length|newline-json|streamable-http>] [--url <endpoint>] [--header KEY=VALUE ...] [--env KEY=VALUE ...] [-- <command> [args...]]
oncecode mcp login <name> --token <bearer-token>
oncecode mcp logout <name>
oncecode mcp remove <name> [--project]

oncecode skills list
oncecode skills add <path-to-skill-or-dir> [--name <name>] [--project]
oncecode skills remove <name> [--project]`)
}

function parseScope(args: string[]): {
  scope: McpConfigScope
  rest: string[]
} {
  const rest = [...args]
  const projectIndex = rest.indexOf('--project')
  if (projectIndex !== -1) {
    rest.splice(projectIndex, 1)
    return { scope: 'project', rest }
  }
  return { scope: 'user', rest }
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value) {
    throw new Error(t('manage_missing_value', { name }))
  }
  args.splice(index, 2)
  return value
}

function takeRepeatOption(args: string[], name: string): string[] {
  const values: string[] = []
  while (true) {
    const index = args.indexOf(name)
    if (index === -1) break
    const value = args[index + 1]
    if (!value) {
      throw new Error(t('manage_missing_value', { name }))
    }
    values.push(value)
    args.splice(index, 2)
  }
  return values
}

function parseEnvPairs(values: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entry of values) {
    const separator = entry.indexOf('=')
    if (separator === -1) {
      throw new Error(t('manage_invalid_env', { value: entry }))
    }
    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1)
    if (!key) {
      throw new Error(t('manage_invalid_env', { value: entry }))
    }
    env[key] = value
  }
  return env
}

async function handleMcpCommand(cwd: string, args: string[]): Promise<boolean> {
  const [subcommand, ...restArgs] = args
  if (!subcommand) {
    printUsage()
    return true
  }

  const { scope, rest } = parseScope(restArgs)

  if (subcommand === 'list') {
    const servers = await loadScopedMcpServers(scope, cwd)
    if (Object.keys(servers).length === 0) {
      console.log(t('manage_mcp_no_servers', {
        path: getMcpConfigPath(scope, cwd),
      }))
      return true
    }

    for (const [name, server] of Object.entries(servers)) {
      const endpoint =
        server.url?.trim() ||
        `${server.command ?? ''} ${server.args?.join(' ') ?? ''}`.trim()
      const protocol = server.protocol ? ` protocol=${server.protocol}` : ''
      console.log(`${name}: ${endpoint}${protocol}`.trim())
    }
    return true
  }

  if (subcommand === 'add') {
    const separatorIndex = rest.indexOf('--')
    const head = separatorIndex === -1 ? [...rest] : rest.slice(0, separatorIndex)
    const commandParts = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1)
    const name = head.shift()
    if (!name) {
      throw new Error(t('manage_mcp_missing_name'))
    }

    const protocol = takeOption(head, '--protocol') as McpServerConfig['protocol']
    const url = takeOption(head, '--url')?.trim()
    const env = parseEnvPairs(takeRepeatOption(head, '--env'))
    const headers = parseEnvPairs(takeRepeatOption(head, '--header'))
    if (head.length > 0) {
      throw new Error(t('manage_unknown_args', { args: head.join(' ') }))
    }

    const hasUrl = Boolean(url)
    const hasCommand = commandParts.length > 0
    if (hasUrl && hasCommand) {
      throw new Error(t('manage_url_command_conflict'))
    }
    if (!hasUrl && !hasCommand) {
      throw new Error(t('manage_mcp_missing_command'))
    }
    if (protocol === 'streamable-http' && !hasUrl) {
      throw new Error(t('manage_protocol_requires_url'))
    }

    const [command = '', ...commandArgs] = commandParts
    const existing = await loadScopedMcpServers(scope, cwd)
    existing[name] = {
      command,
      args: hasCommand ? commandArgs : undefined,
      env: Object.keys(env).length > 0 ? env : undefined,
      url: hasUrl ? url : undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      protocol,
    }
    await saveScopedMcpServers(scope, existing, cwd)
    console.log(t('manage_mcp_added', {
      name,
      path: getMcpConfigPath(scope, cwd),
    }))
    return true
  }

  if (subcommand === 'remove') {
    const name = rest[0]
    if (!name) {
      throw new Error(t('manage_mcp_missing_name'))
    }
    const existing = await loadScopedMcpServers(scope, cwd)
    if (!(name in existing)) {
      console.log(t('manage_mcp_not_found', {
        name,
        path: getMcpConfigPath(scope, cwd),
      }))
      return true
    }
    delete existing[name]
    await saveScopedMcpServers(scope, existing, cwd)
    console.log(t('manage_mcp_removed', {
      name,
      path: getMcpConfigPath(scope, cwd),
    }))
    return true
  }

  if (subcommand === 'login') {
    const name = rest[0]
    if (!name) {
      throw new Error(t('manage_mcp_missing_name'))
    }
    const token = takeOption(rest, '--token')?.trim()
    if (!token) {
      throw new Error(t('manage_missing_token'))
    }
    if (rest.length > 1) {
      throw new Error(t('manage_unknown_args', {
        args: rest.slice(1).join(' '),
      }))
    }
    const tokens = await readMcpTokensFile()
    tokens[name] = token
    await saveMcpTokensFile(tokens)
    console.log(t('manage_mcp_token_stored', {
      name,
      path: ONCECODE_MCP_TOKENS_PATH,
    }))
    return true
  }

  if (subcommand === 'logout') {
    const name = rest[0]
    if (!name) {
      throw new Error(t('manage_mcp_missing_name'))
    }
    const tokens = await readMcpTokensFile()
    if (!(name in tokens)) {
      console.log(t('manage_mcp_token_not_found', {
        name,
        path: ONCECODE_MCP_TOKENS_PATH,
      }))
      return true
    }
    delete tokens[name]
    await saveMcpTokensFile(tokens)
    console.log(t('manage_mcp_token_removed', {
      name,
      path: ONCECODE_MCP_TOKENS_PATH,
    }))
    return true
  }

  printUsage()
  return true
}

async function handleSkillsCommand(cwd: string, args: string[]): Promise<boolean> {
  const [subcommand, ...restArgs] = args
  if (!subcommand) {
    printUsage()
    return true
  }

  const { scope, rest } = parseScope(restArgs)

  if (subcommand === 'list') {
    const skills = await discoverSkills(cwd)
    if (skills.length === 0) {
      console.log(t('skill_none'))
      return true
    }
    for (const skill of skills) {
      console.log(`${skill.name}: ${skill.description} (${skill.path})`)
    }
    return true
  }

  if (subcommand === 'add') {
    const sourcePath = rest[0]
    if (!sourcePath) {
      throw new Error(t('manage_missing_skill_path'))
    }
    const name = takeOption(rest, '--name')
    const result = await installSkill({
      cwd,
      sourcePath,
      name,
      scope,
    })
    console.log(t('skill_installed', {
      name: result.name,
      path: result.targetPath,
    }))
    return true
  }

  if (subcommand === 'remove') {
    const name = rest[0]
    if (!name) {
      throw new Error(t('manage_missing_skill_name'))
    }
    const result = await removeManagedSkill({
      cwd,
      name,
      scope,
    })
    if (!result.removed) {
      console.log(t('skill_not_found', {
        name,
        path: result.targetPath,
      }))
      return true
    }
    console.log(t('skill_removed', {
      name,
      path: result.targetPath,
    }))
    return true
  }

  printUsage()
  return true
}

export async function maybeHandleManagementCommand(
  cwd: string,
  argv: string[],
): Promise<boolean> {
  const [category, ...rest] = argv
  if (!category) {
    return false
  }

  if (category === 'mcp') {
    return handleMcpCommand(cwd, rest)
  }

  if (category === 'skills') {
    return handleSkillsCommand(cwd, rest)
  }

  if (category === 'help' || category === '--help' || category === '-h') {
    printUsage()
    return true
  }

  return false
}
