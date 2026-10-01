import { describe, expect, it } from 'vitest'
import { fixture, storeOf } from '../testing/store-fixture.ts'

// Needs `--expose-gc`; `vitest.config.ts` passes it to the test workers.
const gc = (globalThis as { gc?: () => void }).gc

async function collect(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise(resolve => setTimeout(resolve, 0))
    gc!()
  }
}

describe('TraceStore memory', () => {
  it('lets an evicted trace be collected while its owner connection stays open', async () => {
    expect(gc, 'run with --expose-gc').toBeTypeOf('function')
    const f = fixture()
    for (const name of ['a', 'b', 'c', 'd']) {
      f.write(`/logs/${name}.jsonl`, [{ id: 'u1', kind: 'user', text: name }])
    }
    let payload: WeakRef<object> | undefined
    const { store } = storeOf({
      io: f.io,
      parse: file => {
        const trace = f.parse(file)
        if (file.endsWith('/a.jsonl')) {
          payload = new WeakRef(trace.events[0]!.payload)
        }
        return trace
      },
    })
    const browser = {}
    const handle = await store.open('a', browser)
    await handle.done
    await store.view('a')
    await collect()
    expect(payload?.deref()).toBeDefined()

    for (const name of ['b', 'c', 'd']) {
      await store.view(name)
    }
    expect(store.cachedKeys()).toEqual(['b', 'c', 'd'])
    await collect()
    expect(payload?.deref()).toBeUndefined()
    // The connection and its handle are still alive.
    expect(browser).toBeDefined()
    expect(handle.cached).toBe(false)
  })
})
