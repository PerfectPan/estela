import { describe, expect, it } from 'vitest'
import { isTrace } from './index.ts'
import { traceSchema } from './types.ts'

const source = { file: 'f', offset: 0, length: 1, line: 1 }

function event(partial: Record<string, unknown> = {}) {
  return { id: 'e', seq: 0, ts: 1, kind: 'user', payload: {}, source, ...partial }
}

function trace(partial: Record<string, unknown> = {}) {
  return {
    schema: 'agent-trace',
    host: { id: 'demo' },
    session: { id: 's' },
    capabilities: [],
    agents: [],
    events: [],
    skipped: [],
    ...partial,
  }
}

describe('isTrace', () => {
  it('accepts an empty canonical trace', () => {
    expect(isTrace(trace())).toBe(true)
  })

  it('accepts a populated trace with optional fields', () => {
    expect(isTrace(trace({
      host: { id: 'demo', version: '1.0.0' },
      session: { id: 's', title: 't', cwd: '/w', startedAt: 1, endedAt: 2 },
      capabilities: ['requests', 'usage'],
      agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'e', title: 'x' }],
      events: [event({ agentId: 'main', requestId: 'r', shadowedBy: 'c', original: { raw: true } })],
      skipped: [{ line: 3, file: 'f', reason: 'bad json' }],
    }))).toBe(true)
  })

  it('allows extra payload keys and extra top-level keys', () => {
    expect(isTrace(trace({
      events: [event({ kind: 'request', payload: { model: 'm', anything: [1, { deep: true }] } })],
      extra: 'ignored',
    }))).toBe(true)
  })

  it('rejects non-objects and a wrong schema marker', () => {
    expect(isTrace(null)).toBe(false)
    expect(isTrace([])).toBe(false)
    expect(isTrace('agent-trace')).toBe(false)
    expect(isTrace(trace({ schema: 'other' }))).toBe(false)
    expect(isTrace(trace({ host: {} }))).toBe(false)
    expect(isTrace(trace({ session: { id: 1 } }))).toBe(false)
  })

  it('rejects an event kind outside EVENT_KINDS', () => {
    expect(isTrace(trace({ events: [event({ kind: 'nope' })] }))).toBe(false)
  })

  it('rejects missing or mistyped source fields', () => {
    for (const key of ['file', 'offset', 'length', 'line']) {
      const rest = Object.fromEntries(Object.entries(source).filter(([name]) => name !== key))
      expect(isTrace(trace({ events: [event({ source: rest })] }))).toBe(false)
    }
    expect(isTrace(trace({ events: [event({ source: { ...source, line: '1' } })] }))).toBe(false)
    expect(isTrace(trace({ events: [event({ source: undefined })] }))).toBe(false)
  })

  it('rejects a non-record payload', () => {
    expect(isTrace(trace({ events: [event({ payload: [] })] }))).toBe(false)
    expect(isTrace(trace({ events: [event({ payload: 'x' })] }))).toBe(false)
  })

  it('rejects bad capabilities', () => {
    expect(isTrace(trace({ capabilities: [1] }))).toBe(false)
    expect(isTrace(trace({ capabilities: ['notACapability'] }))).toBe(false)
    expect(isTrace(trace({ capabilities: 'usage' }))).toBe(false)
  })

  it('rejects malformed agents and skipped entries', () => {
    expect(isTrace(trace({ agents: [{ parentId: 'main' }] }))).toBe(false)
    expect(isTrace(trace({ agents: [{ id: 1 }] }))).toBe(false)
    expect(isTrace(trace({ agents: [{ id: 'a', parentId: 2 }] }))).toBe(false)
    expect(isTrace(trace({ skipped: [{ line: 1 }] }))).toBe(false)
    expect(isTrace(trace({ skipped: [{ line: '1', file: 'f', reason: 'x' }] }))).toBe(false)
  })

  it('matches traceSchema.safeParse', () => {
    const value = trace({ events: [event()] })
    expect(isTrace(value)).toBe(traceSchema.safeParse(value).success)
  })
})
