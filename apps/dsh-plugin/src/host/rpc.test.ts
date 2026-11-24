import { describe, expect, it, vi } from 'vite-plus/test'
import { resolveConnectionRpc, type HostConnection, type HostConnectionRpc } from './rpc.ts'

describe('resolveConnectionRpc', () => {
  it('invokes the prototype rpc getter directly instead of reading through a proxy trap', () => {
    const handle = vi.fn<HostConnectionRpc['handle']>()
    const getterThis: unknown[] = []

    class FakeConnection implements HostConnection {
      get rpc(): HostConnectionRpc {
        getterThis.push(this)
        return { handle }
      }
    }

    const target = new FakeConnection()
    // Simulates Cordis on dsh 0.2.2-rc.5: reading `connection.rpc` via Proxy `get` throws, while
    // calling the prototype getter with the proxy as `this` succeeds.
    const proxy = new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop === 'rpc') {
          throw new Error('cannot get property "webServer" without inject')
        }
        return Reflect.get(obj, prop, receiver)
      },
    })

    const rpc = resolveConnectionRpc(proxy)
    const noopHandler = async () => ({ ok: true as const, value: { traceId: 't1' } })
    rpc.handle('/estela', noopHandler)

    expect(getterThis).toEqual([proxy])
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle).toHaveBeenCalledWith('/estela', noopHandler)
  })

  it('falls back to a plain own rpc property and preserves its receiver binding', () => {
    const registered: string[] = []
    const plainRpc = {
      channels: registered,
      handle(this: { channels: string[] }, channel: string) {
        this.channels.push(channel)
      },
    }
    const connection: HostConnection = { rpc: plainRpc }

    const rpc = resolveConnectionRpc(connection)
    rpc.handle('/estela', async () => ({ ok: true as const, value: { traceId: 't1' } }))

    expect(registered).toEqual(['/estela'])
  })

  it('throws when the resolved rpc object lacks a handle function', () => {
    // Deliberately passing a malformed runtime object to verify zod boundary validation.
    const malformed = { rpc: {} } as unknown as HostConnection
    expect(() => resolveConnectionRpc(malformed)).toThrow(/invalid/i)
  })
})
