import path from 'node:path'

export type PathIntent = 'read' | 'write' | 'list' | 'search' | 'command_cwd'

export function normalizePath(targetPath: string): string {
  return path.resolve(targetPath)
}

export function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

export function matchesDirectoryPrefix(
  targetPath: string,
  directories: Iterable<string>,
): boolean {
  for (const directory of directories) {
    if (isWithinDirectory(directory, targetPath)) {
      return true
    }
  }

  return false
}

export function formatCommandSignature(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim()
}

export function classifyDangerousCommand(
  command: string,
  args: string[],
): string | null {
  const normalizedArgs = args.map(arg => arg.trim()).filter(Boolean)
  const signature = formatCommandSignature(command, normalizedArgs)

  if (command === 'git') {
    if (normalizedArgs.includes('reset') && normalizedArgs.includes('--hard')) {
      return `git reset --hard can discard local changes (${signature})`
    }

    if (normalizedArgs.includes('clean')) {
      return `git clean can delete untracked files (${signature})`
    }

    if (
      normalizedArgs.includes('checkout') &&
      normalizedArgs.includes('--')
    ) {
      return `git checkout -- can overwrite working tree files (${signature})`
    }

    if (
      normalizedArgs.includes('restore') &&
      normalizedArgs.some(arg => arg.startsWith('--source'))
    ) {
      return `git restore --source can overwrite local files (${signature})`
    }

    if (
      normalizedArgs.includes('push') &&
      normalizedArgs.some(arg => arg === '--force' || arg === '-f')
    ) {
      return `git push --force rewrites remote history (${signature})`
    }
  }

  if (command === 'npm' && normalizedArgs.includes('publish')) {
    return `npm publish affects a registry outside this machine (${signature})`
  }

  if (
    command === 'node' ||
    command === 'python3' ||
    command === 'bun' ||
    command === 'bash' ||
    command === 'sh'
  ) {
    return `${command} can execute arbitrary local code (${signature})`
  }

  return null
}
