import type { EventDetail, TraceViewResult } from '@rivus/estela-rpc/trace-store'
import { afterAll, describe, expect, it, vi } from 'vite-plus/test'

// `@rivus/estela-web/embed` defines `EstelaWorkspaceElement extends HTMLElement` and delegates
// Solid click events on `window.document` at import time; supply minimal DOM stubs in Node.
const stubbedDom = vi.hoisted(() => {
  if (typeof globalThis.window === 'undefined') {
    const doc = { addEventListener() {} }
    Object.assign(globalThis, { window: { document: doc }, document: doc, HTMLElement: class {} })
    return true
  }
  return false
})

import { NoLogError, StaleError } from '@rivus/estela-web/embed'
import {
  CHANNEL,
  CHANNEL_ERROR_CODES,
  type ChannelEndpoint,
  type ChannelInput,
  type ChannelResult,
} from '../contract/channel.ts'
import { createEstelaSource, mapChannelFailure } from './source.ts'
import type { ClientRpc, ClientRpcResult } from './types.ts'

afterAll(() => {
  if (stubbedDom) {
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'HTMLElement')
  }
})

describe('mapChannelFailure', () => {
  it('maps estela/no-log to NoLogError and estela/stale to StaleError', () => {
    const noLog = mapChannelFailure({ code: 'estela/no-log', message: 'no file on disk' })
    expect(noLog).toBeInstanceOf(NoLogError)
    expect(noLog.message).toBe('no file on disk')

    const stale = mapChannelFailure({ code: 'estela/stale', message: 'file changed' })
    expect(stale).toBeInstanceOf(StaleError)
    expect(stale.message).toBe('file changed')
  })

  it('maps every other channel refusal code to a plain Error preserving the message', () => {
    const otherCodes = CHANNEL_ERROR_CODES.filter(code => code !== 'estela/no-log' && code !== 'estela/stale')
    expect(otherCodes.length).toBeGreaterThan(0)
    for (const code of otherCodes) {
      const error = mapChannelFailure({ code, message: `refused: ${code}` })
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(NoLogError)
      expect(error).not.toBeInstanceOf(StaleError)
      expect(error.message).toBe(`refused: ${code}`)
    }

    const fallback = mapChannelFailure({ code: 'gateway/bad-request', message: '' })
    expect(fallback).toBeInstanceOf(Error)
    expect(fallback.message).toBe('gateway/bad-request')
  })
})

describe('createEstelaSource', () => {
  it('opens the session before loading the view on every open() call', async () => {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    let openCount = 0
    const fakeView = { traceId: 'trace-1', trace: {}, summary: {}, bytes: 10 } as unknown as TraceViewResult

    const rpc: ClientRpc = {
      async call<E extends ChannelEndpoint>(
        channel: typeof CHANNEL,
        endpoint: E,
        payload: ChannelInput<E>,
      ): Promise<ClientRpcResult<ChannelResult<E>>> {
        calls.push({ channel, endpoint, payload })
        if (endpoint === 'session/open') {
          openCount += 1
          return { ok: true, value: { traceId: `trace-${openCount}` } as ChannelResult<E> }
        }
        if (endpoint === 'trace/view') {
          const { traceId } = payload as ChannelInput<'trace/view'>
          return { ok: true, value: { ...fakeView, traceId } as ChannelResult<E> }
        }
        return { ok: false, error: { code: 'estela/failed', message: 'unexpected endpoint' } }
      },
    }

    const source = createEstelaSource(rpc, 'sess-42')
    const first = await source.open()
    const second = await source.open()

    expect(first.traceId).toBe('trace-1')
    expect(second.traceId).toBe('trace-2')
    expect(calls).toEqual([
      { channel: CHANNEL, endpoint: 'session/open', payload: { sessionId: 'sess-42' } },
      { channel: CHANNEL, endpoint: 'trace/view', payload: { traceId: 'trace-1' } },
      { channel: CHANNEL, endpoint: 'session/open', payload: { sessionId: 'sess-42' } },
      { channel: CHANNEL, endpoint: 'trace/view', payload: { traceId: 'trace-2' } },
    ])
  })

  it('forwards the traceId passed to event() rather than the most recent open() traceId', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    const fakeEvent = { id: 'ev-9' } as unknown as EventDetail
    const fakeView = { traceId: 'trace-new', trace: {}, summary: {}, bytes: 10 } as unknown as TraceViewResult

    const rpc: ClientRpc = {
      async call<E extends ChannelEndpoint>(
        _channel: typeof CHANNEL,
        endpoint: E,
        payload: ChannelInput<E>,
      ): Promise<ClientRpcResult<ChannelResult<E>>> {
        calls.push({ endpoint, payload })
        if (endpoint === 'session/open') {
          return { ok: true, value: { traceId: 'trace-new' } as ChannelResult<E> }
        }
        if (endpoint === 'trace/view') {
          return { ok: true, value: fakeView as ChannelResult<E> }
        }
        return { ok: true, value: fakeEvent as ChannelResult<E> }
      },
    }

    const source = createEstelaSource(rpc, 'sess-42')
    await source.open()
    const detail = await source.event('trace-older-from-element', 'ev-9')

    expect(detail).toBe(fakeEvent)
    expect(calls.at(-1)).toEqual({
      endpoint: 'trace/event',
      payload: { traceId: 'trace-older-from-element', id: 'ev-9' },
    })
  })

  it('rejects open() and event() with mapped error classes on channel refusal', async () => {
    const makeRpc = (code: string, message: string): ClientRpc => ({
      async call() {
        return { ok: false, error: { code, message } }
      },
    })

    await expect(createEstelaSource(makeRpc('estela/no-log', 'no log'), 'sess-1').open()).rejects.toBeInstanceOf(
      NoLogError,
    )
    await expect(
      createEstelaSource(makeRpc('estela/stale', 'stale'), 'sess-1').event('t-1', 'e-1'),
    ).rejects.toBeInstanceOf(StaleError)
    await expect(createEstelaSource(makeRpc('estela/unknown-session', 'missing'), 'sess-1').open()).rejects.toThrow(
      'missing',
    )
  })

  it('retries open() with a fresh session/open when trace/view returns estela/stale', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    let openCount = 0
    let viewCount = 0
    const fakeView = { traceId: 'trace-3', trace: {}, summary: {}, bytes: 10 } as unknown as TraceViewResult

    const rpc: ClientRpc = {
      async call<E extends ChannelEndpoint>(
        _channel: typeof CHANNEL,
        endpoint: E,
        payload: ChannelInput<E>,
      ): Promise<ClientRpcResult<ChannelResult<E>>> {
        calls.push({ endpoint, payload })
        if (endpoint === 'session/open') {
          openCount += 1
          return { ok: true, value: { traceId: `trace-${openCount}` } as ChannelResult<E> }
        }
        if (endpoint === 'trace/view') {
          viewCount += 1
          if (viewCount < 3) {
            return { ok: false, error: { code: 'estela/stale', message: 'log changed before view' } }
          }
          const { traceId } = payload as ChannelInput<'trace/view'>
          return { ok: true, value: { ...fakeView, traceId } as ChannelResult<E> }
        }
        return { ok: false, error: { code: 'estela/failed', message: 'unexpected endpoint' } }
      },
    }

    const result = await createEstelaSource(rpc, 'sess-live').open()

    expect(result.traceId).toBe('trace-3')
    expect(calls).toEqual([
      { endpoint: 'session/open', payload: { sessionId: 'sess-live' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-1' } },
      { endpoint: 'session/open', payload: { sessionId: 'sess-live' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-2' } },
      { endpoint: 'session/open', payload: { sessionId: 'sess-live' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-3' } },
    ])
  })

  it('rejects with StaleError once open() exhausts its stale retry limit', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []
    let openCount = 0

    const rpc: ClientRpc = {
      async call<E extends ChannelEndpoint>(
        _channel: typeof CHANNEL,
        endpoint: E,
        payload: ChannelInput<E>,
      ): Promise<ClientRpcResult<ChannelResult<E>>> {
        calls.push({ endpoint, payload })
        if (endpoint === 'session/open') {
          openCount += 1
          return { ok: true, value: { traceId: `trace-${openCount}` } as ChannelResult<E> }
        }
        return { ok: false, error: { code: 'estela/stale', message: 'keeps changing' } }
      },
    }

    await expect(createEstelaSource(rpc, 'sess-busy').open()).rejects.toBeInstanceOf(StaleError)
    // 1 initial attempt + 3 retries, each re-calling session/open for a fresh traceId.
    expect(calls).toEqual([
      { endpoint: 'session/open', payload: { sessionId: 'sess-busy' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-1' } },
      { endpoint: 'session/open', payload: { sessionId: 'sess-busy' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-2' } },
      { endpoint: 'session/open', payload: { sessionId: 'sess-busy' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-3' } },
      { endpoint: 'session/open', payload: { sessionId: 'sess-busy' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-4' } },
    ])
  })

  it('does not retry non-stale trace/view refusals inside open()', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = []

    const rpc: ClientRpc = {
      async call<E extends ChannelEndpoint>(
        _channel: typeof CHANNEL,
        endpoint: E,
        payload: ChannelInput<E>,
      ): Promise<ClientRpcResult<ChannelResult<E>>> {
        calls.push({ endpoint, payload })
        if (endpoint === 'session/open') {
          return { ok: true, value: { traceId: 'trace-1' } as ChannelResult<E> }
        }
        return { ok: false, error: { code: 'estela/failed', message: 'read failed' } }
      },
    }

    await expect(createEstelaSource(rpc, 'sess-err').open()).rejects.toThrow('read failed')
    expect(calls).toEqual([
      { endpoint: 'session/open', payload: { sessionId: 'sess-err' } },
      { endpoint: 'trace/view', payload: { traceId: 'trace-1' } },
    ])
  })
})
