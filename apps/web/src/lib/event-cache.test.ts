import { describe, expect, it } from 'vitest'
import { createEventCache, rawFetchKey } from './event-cache.ts'

describe('inspector event cache', () => {
  it('keeps at most `size` events, dropping the least recently used', async () => {
    const loads: string[] = []
    const get = createEventCache(async id => {
      loads.push(id)
      return id
    }, 2)
    await get('a')
    await get('b')
    await get('a')
    await get('c')
    await get('a')
    await get('b')
    expect(loads).toEqual(['a', 'b', 'c', 'b'])
  })

  it('forgets a failed load', async () => {
    let calls = 0
    const get = createEventCache(async () => {
      calls += 1
      if (calls === 1) {
        throw new Error('x')
      }
      return 'ok'
    })
    await expect(get('a')).rejects.toThrow('x')
    await Promise.resolve()
    await expect(get('a')).resolves.toBe('ok')
  })

  it('makes no get-event call for 30 selections after Raw was opened once and closed', async () => {
    const loads: string[] = []
    const get = createEventCache(async id => {
      loads.push(id)
      return id
    })
    const select = async (tab: string, ids: string[]) => {
      const key = rawFetchKey(tab, ids)
      if (key) {
        await Promise.all(key.split('\0').map(get))
      }
    }
    await select('raw', ['e0'])
    expect(loads).toEqual(['e0'])
    for (let index = 1; index <= 30; index++) {
      await select('input', [`e${index}`, `r${index}`])
    }
    expect(loads).toEqual(['e0'])
    await select('raw', ['e30', 'r30'])
    expect(loads).toEqual(['e0', 'e30', 'r30'])
  })
})
