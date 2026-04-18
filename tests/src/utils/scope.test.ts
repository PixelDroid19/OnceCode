import { describe, expect, it } from 'vitest'
import { Scope, acquireUseRelease, withScope } from '@/utils/scope'

describe('Scope', () => {
  it('runs finalizers in reverse (LIFO) order', async () => {
    const order: number[] = []
    const scope = new Scope()
    scope.addFinalizer(() => { order.push(1) })
    scope.addFinalizer(() => { order.push(2) })
    scope.addFinalizer(() => { order.push(3) })
    await scope.close()
    expect(order).toEqual([3, 2, 1])
  })

  it('closes child scopes before parent finalizers', async () => {
    const order: string[] = []
    const parent = new Scope()
    parent.addFinalizer(() => { order.push('parent') })
    const child = parent.fork()
    child.addFinalizer(() => { order.push('child') })
    await parent.close()
    expect(order).toEqual(['child', 'parent'])
  })

  it('cannot add finalizer to closed scope', async () => {
    const scope = new Scope()
    await scope.close()
    expect(() => scope.addFinalizer(() => {})).toThrow('Cannot add finalizer to closed scope')
  })

  it('cannot fork a closed scope', async () => {
    const scope = new Scope()
    await scope.close()
    expect(() => scope.fork()).toThrow('Cannot fork a closed scope')
  })

  it('close() is idempotent', async () => {
    const order: number[] = []
    const scope = new Scope()
    scope.addFinalizer(() => { order.push(1) })
    await scope.close()
    await scope.close()
    expect(order).toEqual([1])
    expect(scope.isClosed).toBe(true)
  })

  it('collects errors from finalizers without stopping', async () => {
    const scope = new Scope()
    scope.addFinalizer(() => { throw new Error('err1') })
    scope.addFinalizer(() => { throw new Error('err2') })
    await expect(scope.close()).rejects.toThrow('Scope cleanup errors: err2; err1')
  })
})

describe('acquireUseRelease', () => {
  it('calls release on success', async () => {
    let released = false
    const result = await acquireUseRelease(
      async () => 'resource',
      async (r) => r + '!',
      async (_r, status) => {
        released = true
        expect(status.type).toBe('success')
      },
    )
    expect(result).toBe('resource!')
    expect(released).toBe(true)
  })

  it('calls release on failure', async () => {
    let releaseStatus: string | undefined
    await expect(
      acquireUseRelease(
        async () => 'res',
        async () => { throw new Error('boom') },
        async (_r, status) => { releaseStatus = status.type },
      ),
    ).rejects.toThrow('boom')
    expect(releaseStatus).toBe('failure')
  })
})

describe('withScope', () => {
  it('closes scope on success', async () => {
    let closed = false
    const result = await withScope(async (scope) => {
      scope.addFinalizer(() => { closed = true })
      return 42
    })
    expect(result).toBe(42)
    expect(closed).toBe(true)
  })

  it('closes scope on failure', async () => {
    let closed = false
    await expect(
      withScope(async (scope) => {
        scope.addFinalizer(() => { closed = true })
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')
    expect(closed).toBe(true)
  })
})
