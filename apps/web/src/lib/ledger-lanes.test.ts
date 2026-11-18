import { describe, expect, it } from 'vite-plus/test'
import { event, LONG_EVENT_COUNT, LONG_TEST_TIMEOUT_MS, sample, view } from '@/testsupport/ledger-trace.ts'
import { flattenLanes } from './ledger-lanes.ts'
import { anchorIndex, buildLedgerModel, flattenLedger, ROW_SIZE } from './ledger-model.ts'

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

  it('draws a long lane without passing its rows as function arguments', { timeout: LONG_TEST_TIMEOUT_MS }, () => {
    const trace = sample()
    trace.agents = [{ id: 'main' }]
    trace.events = Array.from({ length: LONG_EVENT_COUNT }, (_, seq) =>
      event({
        id: `long-${seq}`,
        kind: seq === 0 ? 'user' : 'assistant',
        payload: { text: 'message' },
      }),
    )
    const rows = flattenLanes(buildLedgerModel(trace), view())
    expect(rows).toHaveLength(LONG_EVENT_COUNT + 1)
    expect(rows.at(-1)?.key).toBe(`e:long-${LONG_EVENT_COUNT - 1}`)
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
    // main lane first, then the sub agent; headers carry `l:` keys and the lane's request count.
    const lanes = rows.filter(row => row.type === 'lane')
    expect(lanes.map(lane => [lane.laneId, lane.requests])).toEqual([
      ['main', 2],
      ['sub', 1],
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
