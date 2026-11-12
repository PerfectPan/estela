import type { Trace, TraceEvent } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import { TraceIds } from './trace-ids.ts'

function eventOf(id: string, seq: number, agentId?: string): TraceEvent {
  return {
    id,
    seq,
    ts: seq + 1,
    kind: 'user',
    payload: {},
    source: { file: 'f', offset: 0, length: 1, line: seq + 1 },
    ...(agentId ? { agentId } : {}),
  }
}

const trace: Trace = {
  schema: 'estela',
  agent: 'test',
  session: { id: 's' },
  capabilities: [],
  agents: [{ id: 'main' }, { id: 'sub agent!', parentId: 'main' }],
  events: [eventOf('u1', 0), eventOf('run rm -rf /', 1, 'sub agent!'), eventOf('-Users-me-x', 2)],
  skipped: [],
}

describe('TraceIds', () => {
  const ids = new TraceIds(trace, id => !id.includes('-Users-me'))

  it('shows safe ids as recorded and the rest as aliases', () => {
    expect(ids.events(['u1', 'run rm -rf /', '-Users-me-x', 'gone!'])).toEqual(['u1', '@e1', '@e2', '@e?'])
    expect([ids.lane('main'), ids.lane('sub agent!')]).toEqual(['main', '@l1'])
  })

  it('resolves aliases and safe ids, never an unsafe id written out', () => {
    expect(ids.findEvent('@e1')).toBe('run rm -rf /')
    expect(ids.findEvent('u1')).toBe('u1')
    expect(ids.findEvent('run rm -rf /')).toBeUndefined()
    expect(ids.findEvent('@e9')).toBeUndefined()
    expect(ids.findLane('@l1')).toBe('sub agent!')
    expect(ids.findLane('main')).toBe('main')
    expect(ids.findLane('other')).toBeUndefined()
  })

  it('names the last event of a duplicate id, as the store does', () => {
    const twice: Trace = { ...trace, events: [eventOf('dup id', 0), eventOf('u1', 1), eventOf('dup id', 2)] }
    const dup = new TraceIds(twice, () => true)
    expect(dup.event('dup id')).toBe('@e2')
    expect(dup.findEvent('@e2')).toBe('dup id')
    expect(dup.findEvent('@e0')).toBeUndefined()
  })
})
