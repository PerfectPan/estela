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

  it('shows an id no event has as @e? or @l?, and never an unsafe id written out', () => {
    // Also when it has the shape of an alias: nothing may read as naming an event of this trace by position.
    expect([ids.event('@e1'), ids.event('@e3'), ids.event('@e?'), ids.lane('@l1'), ids.lane('no lane!')]).toEqual([
      '@e?',
      '@e?',
      '@e?',
      '@l?',
      '@l?',
    ])
  })

  it('keeps a reference to no event as recorded, unless it reads as an alias', () => {
    expect([ids.reference('u1'), ids.reference('gone!'), ids.reference('@e1'), ids.reference('@e?')]).toEqual([
      'u1',
      'gone!',
      '@e?',
      '@e?',
    ])
    expect([ids.laneReference('main'), ids.laneReference('no lane'), ids.laneReference('@l1')]).toEqual([
      'main',
      'no lane',
      '@l?',
    ])
  })

  it('aliases a recorded id that only looks like an alias by its own index', () => {
    const sneaky = new TraceIds({ ...trace, events: [eventOf('@e1', 0), eventOf('u1', 1)] }, () => true)
    expect([sneaky.event('@e1'), sneaky.findEvent('@e1'), sneaky.findEvent('@e0')]).toEqual(['@e0', 'u1', '@e1'])
  })

  it('maps a reconstruction so that every id it returns meets the view', () => {
    const shown = ids.surface({
      eventId: 'run rm -rf /',
      completeness: 'partial',
      unavailable: [],
      visibleIds: ['u1', 'run rm -rf /', '-Users-me-x'],
      slots: [{ name: 'system', status: 'present', eventIds: [], recordedBy: '-Users-me-x' }],
      removedIds: ['-Users-me-x'],
    })
    expect(shown).toEqual({
      eventId: '@e1',
      completeness: 'partial',
      unavailable: [],
      visibleIds: ['u1', '@e1', '@e2'],
      slots: [{ name: 'system', status: 'present', eventIds: [], recordedBy: '@e2' }],
      removedIds: ['@e2'],
    })
    expect(ids.surface({ eventId: 'u1', visibleIds: [], unavailable: [], completeness: 'full' })).not.toHaveProperty(
      'removedIds',
    )
  })

  it('names the last event of a duplicate id, as the store does', () => {
    const twice: Trace = { ...trace, events: [eventOf('dup id', 0), eventOf('u1', 1), eventOf('dup id', 2)] }
    const dup = new TraceIds(twice, () => true)
    expect(dup.event('dup id')).toBe('@e2')
    expect(dup.findEvent('@e2')).toBe('dup id')
    expect(dup.findEvent('@e0')).toBeUndefined()
  })
})
