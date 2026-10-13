import type { ReportTrace } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import type { LoadClient } from './load-session.ts'
import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createSessionLoad, reportSession } from './load-session.ts'

type Status = LoadClient['status']

const trace: Trace = {
  schema: 'agent-trace',
  agent: { id: 'claude-code' },
  session: { id: 's' },
  capabilities: [],
  agents: [],
  events: [],
  skipped: [],
}

/** A fake DevFrame client: `get-trace-view` resolves when `finish` is called, or fails with `reject`. */
function fakeClient(options: { viewError?: string } = {}) {
  const listeners = new Set<(status: Status) => void>()
  let finish: (() => void) | undefined
  let rejectView: ((error: Error) => void) | undefined
  let cancelled = 0
  const chunks: { bytesRead: number; totalBytes: number }[] = []
  const client: LoadClient = {
    status: 'connected',
    onStatus: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    call: (async (method: string): Promise<unknown> => {
      if (method === 'load-trace') {
        return { loadId: 'id-1', cached: false, totalBytes: 100 }
      }
      if (method === 'get-trace-view') {
        if (options.viewError) {
          throw new Error(options.viewError)
        }
        await new Promise<void>((resolve, reject) => {
          finish = resolve
          rejectView = reject
        })
        return { ref: 'r', trace, summary: { turns: 1 }, bytes: 1 }
      }
      throw new Error(`unexpected ${method}`)
    }) as unknown as LoadClient['call'],
    subscribe: () => ({
      cancel: () => {
        cancelled += 1
      },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield chunk
        }
      },
    }),
  }
  return {
    client,
    chunks,
    finish: () => finish?.(),
    drop: (status: Status) => {
      client.status = status
      for (const listener of listeners) {
        listener(status)
      }
      rejectView?.(new Error('socket closed'))
    },
    cancelled: () => cancelled,
  }
}

function event(id: string, text: string) {
  return {
    id,
    seq: 0,
    ts: 0,
    kind: 'user' as const,
    payload: { text },
    source: { file: '0', offset: 0, length: 1, line: 1 },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('createSessionLoad', () => {
  it('shows progress, then the view', async () => {
    const fake = fakeClient()
    fake.chunks.push({ bytesRead: 40, totalBytes: 100 })
    const { load, dispose } = createRoot(stop => ({
      load: createSessionLoad('r', async () => fake.client),
      dispose: stop,
    }))
    await tick()
    expect(load.state()).toEqual({ status: 'loading', bytesRead: 40, totalBytes: 100 })
    fake.finish()
    await tick()
    const state = load.state()
    expect(state.status).toBe('ready')
    expect(state.status === 'ready' && state.session.summary).toEqual({ turns: 1 })
    dispose()
    expect(fake.cancelled()).toBe(1)
  })

  it('splits an agent error into agent, file, line, and reason', async () => {
    const fake = fakeClient({ viewError: 'claude-code: ~/.claude/projects/a/s.jsonl:3: unknown format generation' })
    const load = createRoot(() => createSessionLoad('r', async () => fake.client))
    await tick()
    expect(load.state()).toEqual({
      status: 'error',
      failure: {
        agent: 'claude-code',
        file: '~/.claude/projects/a/s.jsonl',
        line: 3,
        reason: 'unknown format generation',
      },
    })
  })

  it('keeps any other message as the reason', async () => {
    const fake = fakeClient({ viewError: 'unknown session ref: ffff' })
    const load = createRoot(() => createSessionLoad('r', async () => fake.client))
    await tick()
    expect(load.state()).toEqual({ status: 'error', failure: { reason: 'unknown session ref: ffff' } })
  })

  it('ends the load as "connection lost" when the socket drops, since DevFrame does not reconnect', async () => {
    const fake = fakeClient()
    const load = createRoot(() => createSessionLoad('r', async () => fake.client))
    await tick()
    expect(load.state().status).toBe('loading')
    fake.drop('disconnected')
    await tick()
    expect(load.state()).toEqual({ status: 'error', failure: { reason: 'connection lost', lost: true } })
    expect(fake.cancelled()).toBe(1)
  })

  it('reports a lost connection when the socket is already closed', async () => {
    const fake = fakeClient()
    fake.client.status = 'error'
    const load = createRoot(() => createSessionLoad('r', async () => fake.client))
    await tick()
    expect(load.state()).toEqual({ status: 'error', failure: { reason: 'connection lost', lost: true } })
  })

  it("serves a report's included events in full and marks the rest", async () => {
    const report: ReportTrace = {
      trace: { ...trace, events: [event('a', 'short'), event('b', 'short')] },
      summary: {},
      events: [{ ...event('a', 'full text'), original: { raw: true } }],
      total: 2,
      truncated: true,
    }
    const session = reportSession(report)
    expect(await session.event('a')).toMatchObject({ payload: { text: 'full text' }, original: { raw: true } })
    expect(await session.event('b')).toMatchObject({ payload: { text: 'short' }, notInReport: true })
    await expect(session.event('c')).rejects.toThrow('unknown event c')
  })
})
