import path from 'node:path'
import {
  getPermissionsPath as getStoredPermissionsPath,
  readPermissionStore,
  writePermissionStore,
} from './permission-store.js'
import {
  classifyDangerousCommand,
  formatCommandSignature,
  isWithinDirectory,
  matchesDirectoryPrefix,
  normalizePath,
} from './permission-rules.js'
import type { PathIntent } from './permission-rules.js'
import { t } from './i18n/index.js'

/** The user's response to a permission prompt (allow/deny, scope, persistence). */
export type PermissionDecision =
  | 'allow_once'
  | 'allow_always'
  | 'allow_turn'
  | 'allow_all_turn'
  | 'deny_once'
  | 'deny_always'
  | 'deny_with_feedback'

/** A selectable option presented in a permission prompt. */
export type PermissionChoice = {
  key: string
  label: string
  decision: PermissionDecision
}

/** Result returned from the prompt handler, optionally with user feedback. */
export type PermissionPromptResult = {
  decision: PermissionDecision
  feedback?: string
}

type EnsureCommandOptions = {
  forcePromptReason?: string
}

/** Describes an action that requires user approval before proceeding. */
export type PermissionRequest = {
  kind: 'path' | 'command' | 'edit'
  summary: string
  details: string[]
  scope: string
  choices: PermissionChoice[]
}

/** Callback that presents a permission request to the user and awaits their decision. */
export type PermissionPromptHandler = (
  request: PermissionRequest,
) => Promise<PermissionPromptResult>

/** Enforces path, command, and edit permissions with session and persistent allow/deny lists. */
export class PermissionManager {
  private readonly allowedDirectoryPrefixes = new Set<string>()
  private readonly deniedDirectoryPrefixes = new Set<string>()
  private readonly sessionAllowedPaths = new Set<string>()
  private readonly sessionDeniedPaths = new Set<string>()
  private readonly allowedCommandPatterns = new Set<string>()
  private readonly deniedCommandPatterns = new Set<string>()
  private readonly sessionAllowedCommands = new Set<string>()
  private readonly sessionDeniedCommands = new Set<string>()
  private readonly allowedEditPatterns = new Set<string>()
  private readonly deniedEditPatterns = new Set<string>()
  private readonly sessionAllowedEdits = new Set<string>()
  private readonly sessionDeniedEdits = new Set<string>()
  private readonly turnAllowedEdits = new Set<string>()
  private turnAllowAllEdits = false
  private ready: Promise<void>

  constructor(
    private readonly workspaceRoot: string,
    private readonly prompt?: PermissionPromptHandler,
  ) {
    this.ready = this.initialize()
  }

  private async initialize(): Promise<void> {
    const store = await readPermissionStore()

    for (const directory of store.allowedDirectoryPrefixes ?? []) {
      this.allowedDirectoryPrefixes.add(normalizePath(directory))
    }

    for (const directory of store.deniedDirectoryPrefixes ?? []) {
      this.deniedDirectoryPrefixes.add(normalizePath(directory))
    }

    for (const pattern of store.allowedCommandPatterns ?? []) {
      this.allowedCommandPatterns.add(pattern)
    }

    for (const pattern of store.deniedCommandPatterns ?? []) {
      this.deniedCommandPatterns.add(pattern)
    }

    for (const pattern of store.allowedEditPatterns ?? []) {
      this.allowedEditPatterns.add(normalizePath(pattern))
    }

    for (const pattern of store.deniedEditPatterns ?? []) {
      this.deniedEditPatterns.add(normalizePath(pattern))
    }
  }

  async whenReady(): Promise<void> {
    await this.ready
  }

  beginTurn(): void {
    this.turnAllowedEdits.clear()
    this.turnAllowAllEdits = false
  }

  endTurn(): void {
    this.turnAllowedEdits.clear()
    this.turnAllowAllEdits = false
  }

  getSummary(): string[] {
    const summary = [`cwd: ${this.workspaceRoot}`]

    if (this.allowedDirectoryPrefixes.size > 0) {
      summary.push(
        `extra allowed dirs: ${[...this.allowedDirectoryPrefixes].slice(0, 4).join(', ')}`,
      )
    } else {
      summary.push('extra allowed dirs: none')
    }

    if (this.allowedCommandPatterns.size > 0) {
      summary.push(
        `dangerous allowlist: ${[...this.allowedCommandPatterns].slice(0, 4).join(', ')}`,
      )
    } else {
      summary.push('dangerous allowlist: none')
    }

    if (this.allowedEditPatterns.size > 0) {
      summary.push(
        `trusted edit targets: ${[...this.allowedEditPatterns].slice(0, 2).join(', ')}`,
      )
    }

    return summary
  }

  private async persist(): Promise<void> {
    await writePermissionStore({
      allowedDirectoryPrefixes: [...this.allowedDirectoryPrefixes],
      deniedDirectoryPrefixes: [...this.deniedDirectoryPrefixes],
      allowedCommandPatterns: [...this.allowedCommandPatterns],
      deniedCommandPatterns: [...this.deniedCommandPatterns],
      allowedEditPatterns: [...this.allowedEditPatterns],
      deniedEditPatterns: [...this.deniedEditPatterns],
    })
  }

  async ensurePathAccess(targetPath: string, intent: PathIntent): Promise<void> {
    await this.ready

    const normalizedTarget = normalizePath(targetPath)
    if (isWithinDirectory(this.workspaceRoot, normalizedTarget)) {
      return
    }

    if (
      this.sessionDeniedPaths.has(normalizedTarget) ||
      matchesDirectoryPrefix(normalizedTarget, this.deniedDirectoryPrefixes)
    ) {
      throw new Error(
        t('perm_path_denied', {
          path: normalizedTarget,
        }),
      )
    }

    if (
      this.sessionAllowedPaths.has(normalizedTarget) ||
      matchesDirectoryPrefix(normalizedTarget, this.allowedDirectoryPrefixes)
    ) {
      return
    }

    if (!this.prompt) {
      throw new Error(
        t('perm_path_outside_cwd', {
          target: normalizedTarget,
          cwd: this.workspaceRoot,
        }),
      )
    }

    const scopeDirectory =
      intent === 'list' || intent === 'command_cwd'
        ? normalizedTarget
        : path.dirname(normalizedTarget)

    const promptResult = await this.prompt({
      kind: 'path',
      summary: t('perm_path_access_request', {
        intent: intent.replace('_', ' '),
      }),
      details: [
        `cwd: ${this.workspaceRoot}`,
        `target: ${normalizedTarget}`,
        `scope directory: ${scopeDirectory}`,
      ],
      scope: scopeDirectory,
      choices: [
        { key: 'y', label: t('perm_allow_once'), decision: 'allow_once' },
        { key: 'a', label: t('perm_allow_directory'), decision: 'allow_always' },
        { key: 'n', label: t('perm_deny_once'), decision: 'deny_once' },
        { key: 'd', label: t('perm_deny_directory'), decision: 'deny_always' },
      ],
    })

    if (promptResult.decision === 'allow_once') {
      this.sessionAllowedPaths.add(normalizedTarget)
      return
    }

    if (promptResult.decision === 'allow_always') {
      this.allowedDirectoryPrefixes.add(scopeDirectory)
      await this.persist()
      return
    }

    if (promptResult.decision === 'deny_always') {
      this.deniedDirectoryPrefixes.add(scopeDirectory)
      await this.persist()
    } else {
      this.sessionDeniedPaths.add(normalizedTarget)
    }

    throw new Error(
      t('perm_path_denied', {
        path: normalizedTarget,
      }),
    )
  }

  async ensureCommand(
    command: string,
    args: string[],
    commandCwd: string,
    options?: EnsureCommandOptions,
  ): Promise<void> {
    await this.ready

    await this.ensurePathAccess(commandCwd, 'command_cwd')

    const dangerousReason = classifyDangerousCommand(command, args)
    const reason = options?.forcePromptReason?.trim() || dangerousReason
    if (!reason) {
      return
    }

    const signature = formatCommandSignature(command, args)
    if (
      this.sessionDeniedCommands.has(signature) ||
      this.deniedCommandPatterns.has(signature)
    ) {
      throw new Error(t('perm_command_denied', { signature }))
    }

    if (
      this.sessionAllowedCommands.has(signature) ||
      this.allowedCommandPatterns.has(signature)
    ) {
      return
    }

    if (!this.prompt) {
      throw new Error(
        t('perm_command_requires_approval', {
          signature,
        }),
      )
    }

    const promptResult = await this.prompt({
      kind: 'command',
      summary: options?.forcePromptReason
        ? t('perm_command_approval_request')
        : t('perm_dangerous_command'),
      details: [
        `cwd: ${commandCwd}`,
        `command: ${signature}`,
        `reason: ${reason}`,
      ],
      scope: signature,
      choices: [
        { key: 'y', label: t('perm_allow_once'), decision: 'allow_once' },
        { key: 'a', label: t('perm_always_allow_command'), decision: 'allow_always' },
        { key: 'n', label: t('perm_deny_once'), decision: 'deny_once' },
        { key: 'd', label: t('perm_always_deny_command'), decision: 'deny_always' },
      ],
    })

    if (promptResult.decision === 'allow_once') {
      this.sessionAllowedCommands.add(signature)
      return
    }

    if (promptResult.decision === 'allow_always') {
      this.allowedCommandPatterns.add(signature)
      await this.persist()
      return
    }

    if (promptResult.decision === 'deny_always') {
      this.deniedCommandPatterns.add(signature)
      await this.persist()
    } else {
      this.sessionDeniedCommands.add(signature)
    }

    throw new Error(t('perm_command_denied', { signature }))
  }

  async ensureEdit(targetPath: string, diffPreview: string): Promise<void> {
    await this.ready

    const normalizedTarget = normalizePath(targetPath)

    if (
      this.sessionDeniedEdits.has(normalizedTarget) ||
      this.deniedEditPatterns.has(normalizedTarget)
    ) {
      throw new Error(t('perm_edit_denied', { path: normalizedTarget }))
    }

    if (
      this.sessionAllowedEdits.has(normalizedTarget) ||
      this.turnAllowedEdits.has(normalizedTarget) ||
      this.turnAllowAllEdits ||
      this.allowedEditPatterns.has(normalizedTarget)
    ) {
      return
    }

    if (!this.prompt) {
      throw new Error(
        t('perm_edit_requires_approval', {
          path: normalizedTarget,
        }),
      )
    }

    const promptResult = await this.prompt({
      kind: 'edit',
      summary: t('perm_edit_request'),
      details: [
        `target: ${normalizedTarget}`,
        '',
        diffPreview,
      ],
      scope: normalizedTarget,
      choices: [
        { key: '1', label: t('perm_apply_once'), decision: 'allow_once' },
        { key: '2', label: t('perm_allow_file_turn'), decision: 'allow_turn' },
        { key: '3', label: t('perm_allow_all_edits_turn'), decision: 'allow_all_turn' },
        { key: '4', label: t('perm_always_allow_file'), decision: 'allow_always' },
        { key: '5', label: t('perm_reject_once'), decision: 'deny_once' },
        { key: '6', label: t('perm_reject_with_guidance'), decision: 'deny_with_feedback' },
        { key: '7', label: t('perm_always_reject_file'), decision: 'deny_always' },
      ],
    })

    if (promptResult.decision === 'allow_once') {
      this.sessionAllowedEdits.add(normalizedTarget)
      return
    }

    if (promptResult.decision === 'allow_turn') {
      this.turnAllowedEdits.add(normalizedTarget)
      return
    }

    if (promptResult.decision === 'allow_all_turn') {
      this.turnAllowAllEdits = true
      return
    }

    if (promptResult.decision === 'allow_always') {
      this.allowedEditPatterns.add(normalizedTarget)
      await this.persist()
      return
    }

    if (promptResult.decision === 'deny_with_feedback') {
      const guidance = promptResult.feedback?.trim()
      if (guidance) {
        throw new Error(
          t('perm_edit_denied_with_guidance', {
            path: normalizedTarget,
            guidance,
          }),
        )
      }
      this.sessionDeniedEdits.add(normalizedTarget)
      throw new Error(t('perm_edit_denied', { path: normalizedTarget }))
    }

    if (promptResult.decision === 'deny_always') {
      this.deniedEditPatterns.add(normalizedTarget)
      await this.persist()
    } else {
      this.sessionDeniedEdits.add(normalizedTarget)
    }

    throw new Error(t('perm_edit_denied', { path: normalizedTarget }))
  }
}

/** Returns the filesystem path to the persisted permissions store. */
export function getPermissionsPath(): string {
  return getStoredPermissionsPath()
}
