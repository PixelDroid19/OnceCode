import { describe, expect, it, vi } from 'vitest'
import {
  getBackgroundTask,
  listBackgroundTasks,
  registerBackgroundShellTask,
} from '@/workspace/background-tasks.js'

describe('background-tasks', () => {
  it('registers and lists background tasks', () => {
    const task = registerBackgroundShellTask({
      command: 'sleep 1',
      pid: process.pid,
      cwd: process.cwd(),
    })
    expect(task.taskId).toContain('shell_')
    expect(listBackgroundTasks().some((item) => item.taskId === task.taskId)).toBe(true)
    expect(getBackgroundTask(task.taskId)?.taskId).toBe(task.taskId)
  })

  it('marks missing tasks as completed when pid no longer exists', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('missing') as Error & { code: string }
      error.code = 'ESRCH'
      throw error
    })
    const task = registerBackgroundShellTask({
      command: 'sleep 1',
      pid: 999999,
      cwd: process.cwd(),
    })
    expect(getBackgroundTask(task.taskId)?.status).toBe('completed')
    killSpy.mockRestore()
  })
})
