import { describe, expect, it } from 'vitest'
import { ConcurrencyLimiter } from '@/tools/framework.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('ConcurrencyLimiter', () => {
  it('runs a single task and returns the result', async () => {
    const limiter = new ConcurrencyLimiter(2)
    const result = await limiter.run(async () => 42)
    expect(result).toBe(42)
  })

  it('respects concurrency limit', async () => {
    const limiter = new ConcurrencyLimiter(2)
    let running = 0
    let maxRunning = 0

    const task = async (id: number) => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await sleep(50)
      running--
      return id
    }

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(id => limiter.run(() => task(id))),
    )

    expect(maxRunning).toBeLessThanOrEqual(2)
    expect(results).toEqual([1, 2, 3, 4, 5])
  })

  it('returns all results in correct order', async () => {
    const limiter = new ConcurrencyLimiter(3)

    const results = await Promise.all(
      [10, 20, 30, 40].map(v =>
        limiter.run(async () => {
          await sleep(Math.random() * 20)
          return v * 2
        }),
      ),
    )

    expect(results).toEqual([20, 40, 60, 80])
  })

  it('handles errors without blocking the queue', async () => {
    const limiter = new ConcurrencyLimiter(1)

    const p1 = limiter.run(async () => {
      throw new Error('fail')
    })
    const p2 = limiter.run(async () => 'ok')

    await expect(p1).rejects.toThrow('fail')
    await expect(p2).resolves.toBe('ok')
  })
})
