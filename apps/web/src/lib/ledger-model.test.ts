import type { TranscriptEventKind } from '@rivus/agent-kit/transcript'
import type { Trace, TraceEvent, TraceEventPayloads } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
import {
  anchorIndex,
  buildLedgerModel,
  countEvents,
  flattenLanes,
  flattenLedger,
  moveSelection,
  ROW_SIZE,
  type LedgerView,
} from './ledger-model.ts'

/** An event's id, a kind with that kind's payload, and any other fields. */
type EventInput = Partial<Omit<TraceEvent, 'kind' | 'payload'>> & { id: string } & {
    [K in TranscriptEventKind]: { kind: K; payload: TraceEventPayloads[K] }
  }[TranscriptEventKind]

let seq = 0
function event(input: EventInput): TraceEvent {
  const at = seq++
  return { seq: at, ts: 1000 * at, source: { file: '0', offset: 0, length: 1, line: at + 1 }, ...input }
}

function sample(): Trace {
  seq = 0
  return {
    schema: 'agent-trace',
    agent: 'claude-code',
    session: { id: 's' },
    capabilities: ['requests', 'usage', 'subagents', 'hooks', 'compaction'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'spawn', title: 'Explore' }],
    skipped: [],
    events: [
      event({ id: 'p1', kind: 'user', payload: { text: 'first' } }),
      event({ id: 'r1', kind: 'request', payload: { usage: { inputTokens: 100 } } }),
      event({ id: 'c1', kind: 'tool_call', payload: { callId: 'x1', name: 'Bash', args: { command: 'ls' } } }),
      event({ id: 'o1', kind: 'tool_result', payload: { callId: 'x1', isError: true, exitCode: 1 } }),
      event({ id: 'h1', kind: 'hook', payload: { type: 'hook_success' } }),
      event({ id: 'h2', kind: 'hook', payload: { type: 'hook_success' } }),
      event({ id: 'spawn', kind: 'tool_call', payload: { callId: 'x2', name: 'Task' } }),
      event({ id: 's1', kind: 'request', agentId: 'sub', payload: {} }),
      event({ id: 's2', kind: 'assistant', agentId: 'sub', payload: { text: 'found' } }),
      event({ id: 'spawn-out', kind: 'tool_result', payload: { callId: 'x2' } }),
      event({ id: 'k1', kind: 'compaction', payload: { preTokens: 100, postTokens: 10 } }),
      event({ id: 'p2', kind: 'user', payload: { text: 'second' } }),
      event({ id: 'r2', kind: 'request', payload: {} }),
    ],
  }
}

const view = (partial: Partial<LedgerView> = {}): LedgerView => ({
  collapsed: new Set(),
  expanded: new Set(),
  filter: 'all',
  ...partial,
})

describe('buildLedgerModel', () => {
  it('pairs results with calls, folds hooks, and turns the spawn call into a subagent row', () => {
    const model = buildLedgerModel(sample())
    expect(model.turns.map(turn => turn.id)).toEqual(['t0', 't1'])
    const types = model.turns[0]!.entries.map(entry =>
      entry.type === 'event' ? `${entry.kind}:${entry.eventId}` : entry.type,
    )
    expect(types).toEqual(['user:p1', 'request:r1', 'tool:c1', 'hooks', 'subagent', 'compaction'])
    const tool = model.turns[0]!.entries[2]!
    expect(tool.type === 'event' && tool.resultId).toBe('o1')
    const sub = model.turns[0]!.entries[4]!
    expect(sub.type === 'subagent' && sub.children.map(child => child.type === 'event' && child.eventId)).toEqual([
      's1',
      's2',
    ])
    expect(sub.type === 'subagent' && sub.resultId).toBe('spawn-out')
  })

  it('numbers every row in trace order, skipping paired results and hooks', () => {
    const model = buildLedgerModel(sample())
    expect(model.ordinals.get('p1')).toBe(1)
    expect(model.ordinals.get('c1')).toBe(3)
    expect(model.ordinals.has('o1')).toBe(false)
    expect(model.ordinals.has('h1')).toBe(false)
    expect(model.ordinals.get('spawn')).toBe(4)
    expect(model.ordinals.has('k1')).toBe(false)
    expect(model.ordinals.get('r2')).toBe(8)
  })

  it('locates results, subagent events, and hooks for reveal', () => {
    const model = buildLedgerModel(sample())
    expect(model.locate.get('o1')).toEqual({ turnId: 't0', entryId: 'e:c1', parents: [] })
    expect(model.locate.get('s2')).toEqual({ turnId: 't0', entryId: 'e:s2', parents: ['s:t0:sub'] })
    expect(model.locate.get('h2')).toEqual({ turnId: 't0', entryId: 'e:h2', parents: ['h:h1'] })
  })
})

describe('flattenLedger', () => {
  it('uses fixed sizes per row type', () => {
    const rows = flattenLedger(buildLedgerModel(sample()), view())
    expect(rows.map(row => row.size)).toEqual([
      ROW_SIZE.turn,
      36,
      36,
      36,
      ROW_SIZE.hooks,
      36,
      ROW_SIZE.compaction,
      ROW_SIZE.turn,
      36,
      36,
    ])
  })

  it('collapses a turn to its header and inlines expanded subagent and hook rows', () => {
    const model = buildLedgerModel(sample())
    const collapsed = flattenLedger(model, view({ collapsed: new Set(['t0']) }))
    expect(collapsed.map(row => row.key)).toEqual(['t0', 't1', 'e:p2', 'e:r2'])
    const expanded = flattenLedger(model, view({ expanded: new Set(['s:t0:sub', 'h:h1']) }))
    expect(expanded.map(row => row.key)).toContain('e:s2')
    const hook = expanded.find(row => row.key === 'e:h2')
    expect(hook?.type === 'entry' && hook.depth).toBe(1)
  })

  it('filters by chip and by range, and drops turns with nothing left', () => {
    const model = buildLedgerModel(sample())
    const failures = flattenLedger(model, view({ filter: 'failures' }))
    expect(failures.map(row => row.key)).toEqual(['t0', 'e:c1'])
    const requests = flattenLedger(model, view({ filter: 'requests' }))
    // The subagent row stays because one of its rows is a request, and opens to list it.
    expect(requests.map(row => row.key)).toEqual(['t0', 'e:r1', 's:t0:sub', 'e:s1', 't1', 'e:r2'])
    const late = flattenLedger(model, view({ range: { from: 11_000, to: 12_000 } }))
    expect(late.map(row => row.key)).toEqual(['t1', 'e:p2', 'e:r2'])
  })
})

describe('keyboard and counts', () => {
  it('moves the selection within the list', () => {
    expect(moveSelection(0, -1, 1)).toBe(-1)
    expect(moveSelection(5, -1, 1)).toBe(0)
    expect(moveSelection(5, -1, -1)).toBe(4)
    expect(moveSelection(5, 4, 1)).toBe(4)
    expect(moveSelection(5, 0, -1)).toBe(0)
    expect(moveSelection(5, 2, 1)).toBe(3)
  })

  it('continues from the turn header when the selected row is hidden', () => {
    const model = buildLedgerModel(sample())
    const open = flattenLedger(model, view())
    expect(anchorIndex(open, model, 'e:c1')).toBe(open.findIndex(row => row.key === 'e:c1'))
    const collapsed = flattenLedger(model, view({ collapsed: new Set(['t0']) }))
    expect(anchorIndex(collapsed, model, 'e:c1')).toBe(0)
    const requests = flattenLedger(model, view({ filter: 'requests' }))
    expect(requests[anchorIndex(requests, model, 'e:p2')]!.key).toBe('t1')
    expect(anchorIndex(requests, model, undefined)).toBe(-1)
  })

  it('marks rows inside an expanded subagent lane and indexes requests by lane', () => {
    const model = buildLedgerModel(sample())
    const rows = flattenLedger(model, view({ expanded: new Set(['s:t0:sub']) }))
    const inner = rows.find(row => row.key === 'e:s1')
    expect(inner?.type === 'entry' && inner.lane).toBe(true)
    expect(model.requests.get('s1')?.lane.id).toBe('sub')
    expect(model.requests.get('r2')?.index).toBe(1)
  })

  it('lists under Failures every failed result the chip counts: orphans and second results too', () => {
    const trace = sample()
    const extra = [
      { id: 'orphan', kind: 'tool_result' as const, payload: { callId: 'none', isError: true } },
      { id: 'again', kind: 'tool_result' as const, payload: { callId: 'x1', isError: true } },
    ]
    for (const item of extra) {
      trace.events.push({
        ...item,
        seq: trace.events.length,
        ts: 1000 * trace.events.length,
        source: { file: '0', offset: 0, length: 1, line: trace.events.length + 1 },
      })
    }
    const model = buildLedgerModel(trace)
    const failed = trace.events.filter(item => item.kind === 'tool_result' && item.payload.isError === true).length
    const rows = flattenLedger(model, view({ filter: 'failures' })).filter(row => row.type === 'entry')
    expect(failed).toBe(3)
    expect(rows.map(row => row.key)).toEqual(['e:c1', 'e:orphan', 'e:again'])
  })

  it('counts the events inside a range', () => {
    const trace = sample()
    expect(countEvents(trace)).toBe(13)
    expect(countEvents(trace, { from: 0, to: 2000 })).toBe(3)
  })
  describe('flattenLanes', () => {
    it('keeps a failed spawn visible under Tools and Failures in both layouts', () => {
      const trace = sample()
      trace.events = trace.events.filter(event => event.id !== 's1')
      const result = trace.events.find(event => event.id === 'spawn-out')!
      if (result.kind === 'tool_result') {
        result.payload.isError = true
      }
      const model = buildLedgerModel(trace)
      for (const filter of ['tools', 'failures'] as const) {
        expect(flattenLanes(model, view({ filter })).some(row => row.key === 'e:spawn')).toBe(true)
        expect(flattenLedger(model, view({ filter })).some(row => row.key === 's:t0:sub')).toBe(true)
      }
    })

    it('draws a long lane without passing its rows as function arguments', () => {
      const trace = sample()
      trace.agents = [{ id: 'main' }]
      trace.events = Array.from({ length: 150_000 }, (_, seq) =>
        event({
          id: `long-${seq}`,
          kind: seq % 10 === 0 ? 'user' : 'assistant',
          payload: { text: 'message' },
        }),
      )
      const rows = flattenLanes(buildLedgerModel(trace), view())
      expect(rows).toHaveLength(150_001)
      expect(rows.at(-1)?.key).toBe('e:long-149999')
    })

    it('keeps a subagent hook group from each turn instead of merging away later hooks', () => {
      const trace = sample()
      trace.events = [
        event({ id: 'p1', kind: 'user', payload: {} }),
        event({ id: 'h1', kind: 'hook', agentId: 'sub', payload: { type: 'hook_success' } }),
        event({ id: 'p2', kind: 'user', payload: {} }),
        event({ id: 'h2', kind: 'hook', agentId: 'sub', payload: { type: 'hook_success' } }),
      ]
      const model = buildLedgerModel(trace)
      const rows = flattenLanes(model, view({ expanded: new Set(['h:h1', 'h:h2']) }))
      expect(rows.filter(row => row.type === 'entry').map(row => row.key)).toEqual([
        'e:p1',
        'e:p2',
        'h:h1',
        'e:h1',
        'h:h2',
        'e:h2',
      ])
    })

    it("draws one header per agent lane with its own events flat, sharing the turn layout's entries", () => {
      const model = buildLedgerModel(sample())
      const rows = flattenLanes(model, view())
      // main lane first, then the sub agent; headers carry `l:` keys and the drawn row count.
      const lanes = rows.filter(row => row.type === 'lane')
      expect(lanes.map(lane => [lane.laneId, lane.count])).toEqual([
        ['main', 8],
        ['sub', 2],
      ])
      expect(lanes[0]).toMatchObject({ key: 'l:main', type: 'lane', size: ROW_SIZE.turn })
      // The sub lane's header is followed by its own rows, flat like every lane row.
      const afterSub = rows.slice(rows.findIndex(row => row.type === 'lane' && row.laneId === 'sub') + 1)
      expect(afterSub.map(row => row.key)).toEqual(['e:s1', 'e:s2'])
      // The main lane's flat rows keep the turn layout's entry ids: one event, one row identity.
      const beforeSub = rows.slice(
        0,
        rows.findIndex(row => row.type === 'lane' && row.laneId === 'sub'),
      )
      const mainEntries = beforeSub.filter(row => row.type === 'entry').map(row => row.key)
      expect(mainEntries).toEqual(['e:p1', 'e:r1', 'e:c1', 'h:h1', 'e:spawn', 'e:k1', 'e:p2', 'e:r2'])
    })

    it("collapses a lane to its header with an `l:` key, disjoint from the turn layout's", () => {
      const model = buildLedgerModel(sample())
      const collapsed = flattenLanes(model, view({ collapsed: new Set(['l:main']) }))
      expect(collapsed.filter(row => row.type === 'lane').map(row => row.key)).toEqual(['l:main', 'l:sub'])
      expect(collapsed.filter(row => row.type === 'entry').map(row => row.key)).toEqual(['e:s1', 'e:s2'])
      // The turn layout is untouched by the `l:` key.
      expect(flattenLedger(model, view({ collapsed: new Set(['l:main']) }))).toEqual(flattenLedger(model, view()))
    })

    it('applies the chip and range, and drops a lane with nothing left', () => {
      const model = buildLedgerModel(sample())
      const rows = flattenLanes(model, view({ filter: 'requests' }))
      expect(rows.map(row => row.key)).toEqual(['l:main', 'e:r1', 'e:r2', 'l:sub', 'e:s1'])
      const ranged = flattenLanes(model, view({ range: { from: 0, to: 2000 } }))
      expect(ranged.filter(row => row.type === 'lane').map(row => row.key)).toEqual(['l:main'])
      expect(ranged.filter(row => row.type === 'entry').map(row => row.key)).toEqual(['e:p1', 'e:r1', 'e:c1'])
    })

    it('continues the keyboard from the lane header when the selected row is hidden', () => {
      const model = buildLedgerModel(sample())
      const collapsed = flattenLanes(model, view({ collapsed: new Set(['l:main']) }))
      // `p1` lives on the main lane, which the collapse hid: the anchor falls to `l:main`.
      expect(anchorIndex(collapsed, model, 'e:p1')).toBe(0)
      expect(anchorIndex(collapsed, model, 'e:s1')).toBe(2)
    })
  })
})
