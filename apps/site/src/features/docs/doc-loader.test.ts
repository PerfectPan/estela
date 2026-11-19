import { describe, expect, it, vi } from 'vite-plus/test'
import { createDocLoader } from './doc-loader.ts'
import { docs } from './source.ts'

describe('createDocLoader', () => {
  it('caches one tracked promise per client path and records React thenable fields on settle', async () => {
    const { isDocLoaded, loadDoc } = createDocLoader(() => false)
    const path = 'guide/privacy.md'
    expect(isDocLoaded(path)).toBe(false)

    const first = loadDoc(path)
    const second = loadDoc(path)
    expect(second).toBe(first)
    expect(first.status).toBe('pending')

    const resolved = await first
    // Re-read after await because TS control-flow keeps the pre-await `status: 'pending'` narrowing on `first`.
    const settled = loadDoc(path)
    expect(settled).toBe(first)
    expect(settled.status).toBe('fulfilled')
    expect(settled.status === 'fulfilled' ? settled.value : undefined).toBe(resolved)
    expect(isDocLoaded(path)).toBe(true)
  })

  it('evicts a rejected promise so a subsequent client load retries', async () => {
    const { isDocLoaded, loadDoc } = createDocLoader(() => false)
    const page = docs.getPage('guide/concepts.md')
    if (!page) {
      throw new Error('expected guide/concepts.md')
    }
    const boom = new Error('transient chunk failure')
    const spy = vi
      .spyOn(docs, 'getPage')
      .mockReturnValueOnce({ ...page, load: () => Promise.reject(boom) })
      .mockReturnValueOnce(page)

    const failed = loadDoc('guide/concepts.md')
    await expect(failed).rejects.toThrow('transient chunk failure')
    expect(failed.status).toBe('rejected')
    expect('reason' in failed ? failed.reason : undefined).toBe(boom)
    expect(isDocLoaded('guide/concepts.md')).toBe(false)

    const retried = loadDoc('guide/concepts.md')
    expect(retried).not.toBe(failed)
    await retried
    expect(retried.status).toBe('fulfilled')
    expect(isDocLoaded('guide/concepts.md')).toBe(true)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('skips client cache on SSR so every prerendered route still uses its Suspense boundary', async () => {
    const { isDocLoaded, loadDoc } = createDocLoader(() => true)
    const path = 'guide/privacy.md'

    await loadDoc(path)
    expect(isDocLoaded(path)).toBe(false)
  })
})
