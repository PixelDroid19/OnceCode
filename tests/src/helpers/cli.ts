import { spawn } from 'node:child_process'
import path from 'node:path'

export async function runTsxEntry(args: {
  cwd: string
  entry: string
  argv?: string[]
  stdin?: string
  env?: Record<string, string | undefined>
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const cliPath = path.resolve(args.cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cliPath, args.entry, ...(args.argv ?? [])],
      {
        cwd: args.cwd,
        env: {
          ...process.env,
          ...(args.env ?? {}),
        },
        stdio: 'pipe',
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode })
    })

    if (args.stdin !== undefined) {
      child.stdin.write(args.stdin)
    }
    child.stdin.end()
  })
}

export async function runOnceCodeCli(args: {
  cwd: string
  argv?: string[]
  stdin?: string
  env?: Record<string, string | undefined>
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return runTsxEntry({
    ...args,
    entry: 'src/index.ts',
  })
}
