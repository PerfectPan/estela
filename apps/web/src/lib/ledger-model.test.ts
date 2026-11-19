import { describe, expect, it } from 'vite-plus/test'
import { event, LONG_EVENT_COUNT, LONG_TEST_TIMEOUT_MS, sample, view } from '@/testsupport/ledger-trace.ts'
import { anchorIndex, buildLedgerModel, countEvents, flattenLedger, moveSelection, ROW_SIZE } from './ledger-model.ts'

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

  it('draws a long turn without passing its rows as function arguments', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const trace = sample()
    trace.agents = [{ id: 'main' }]
    trace.events = Array.from({ length: LONG_EVENT_COUNT }, (_, seq) =>
      event({ id: `long-${seq}`, kind: seq === 0 ? 'user' : 'assistant', payload: { text: 'message' } }),
    )
    const rows = flattenLedger(buildLedgerModel(trace), view())
    expect(rows).toHaveLength(LONG_EVENT_COUNT + 1)
    expect(rows.at(-1)?.key).toBe(`e:long-${LONG_EVENT_COUNT - 1}`)
  })
})
