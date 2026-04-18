import { spawn } from 'node:child_process'

/**
 * Runs a command with streaming output, early termination, and size limits.
 * Inspired by Bun's spawn patterns -- uses streams instead of buffering.
 */
export async function execStreaming(args: {
  command: string
  args: string[]
  cwd: string
  maxBytes?: number
  maxLines?: number
  timeoutMs?: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}): Promise<{ stdout: string; stderr: string; exitCode: number | null; truncated: boolean }> {
  const maxBytes = args.maxBytes ?? 1024 * 1024
  const maxLines = args.maxLines ?? 10_000
  const timeoutMs = args.timeoutMs ?? 30_000

  return new Promise((resolve, reject) => {
    const proc = spawn(args.command, args.args, {
      cwd: args.cwd,
      env: args.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: args.signal,
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let lineCount = 0
    let truncated = false
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        truncated = true
        proc.kill('SIGTERM')
      }
    }, timeoutMs)

    const settle = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode, truncated })
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return

      const text = chunk.toString()
      stdoutBytes += chunk.length

      if (stdoutBytes > maxBytes) {
        truncated = true
        stdout += text.slice(0, Math.max(0, maxBytes - (stdoutBytes - chunk.length)))
        proc.kill('SIGTERM')
        return
      }

      // Check line count
      for (const char of text) {
        if (char === '\n') lineCount++
        if (lineCount >= maxLines) {
          truncated = true
          proc.kill('SIGTERM')
          return
        }
      }

      stdout += text
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      // Cap stderr at 64KB
      if (stderr.length < 65_536) {
        stderr += text.slice(0, 65_536 - stderr.length)
      }
    })

    proc.on('error', (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    proc.on('close', (code) => settle(code))
  })
}
