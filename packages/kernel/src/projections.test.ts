import type { EventKind, Trace, TraceEvent, TraceEventPayloads } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
import { projectLanes, projectRequests } from './project-timeline.ts'
import { foldHookRuns, hiddenAfterCompaction, projectTurns } from './project-turns.ts'

type KindAndPayload = { [K in EventKind]: { kind: K; payload: TraceEventPayloads[K] } }[EventKind]

/** A kind with that kind's payload. */
function on<K extends EventKind>(kind: K, payload: TraceEventPayloads[K]): { kind: K; payload: TraceEventPayloads[K] } {
  return { kind, payload }
}

type Spec = [
  id: string,
  event: KindAndPayload,
  extra?: Partial<Omit<TraceEvent, 'kind' | 'payload'>> & { line?: number },
]

function synthetic(specs: Spec[]): Trace {
  const events = specs.map(([id, event, extra = {}], seq): TraceEvent => {
    const { line, ...rest } = extra
    return {
      id,
      seq,
      ts: seq * 10,
      ...event,
      source: { file: 'session.jsonl', offset: 0, length: 1, line: line ?? seq + 1 },
      ...rest,
    }
  })
  return {
    schema: 'agent-trace',
    agent: { id: 'test' },
    session: { id: 's' },
    capabilities: ['requests', 'usage', 'compaction', 'compactionTokens', 'subagents'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 't1', title: 'Helper' }],
    events,
    skipped: [],
  }
}

const trace = synthetic([
  ['pre', on('system', { text: 'setup' })],
  ['p1', on('user', { text: 'Fix it' }), { line: 2 }],
  ['p1b', on('user', { text: 'and test' }), { line: 2 }],
  ['r1', on('request', { model: 'm', usage: { inputTokens: 100, outputTokens: 10 } }), { requestId: 'r1' }],
  ['a1', on('assistant', { text: 'ok' }), { requestId: 'r1', shadowedBy: 'k1' }],
  ['t1', on('tool_call', { callId: 'c1', name: 'bash' }), { requestId: 'r1', shadowedBy: 'k1' }],
  ['h1', on('hook', { type: 'hook' })],
  ['h2', on('hook', { type: 'hook' })],
  ['x1', on('tool_result', { callId: 'c1', isError: true })],
  ['s1', on('user', { text: 'Sub task' }), { agentId: 'sub' }],
  ['r2', on('request', { model: 'm' }), { agentId: 'sub', requestId: 'r2' }],
  ['k1', on('compaction', { trigger: 'auto', preTokens: 1000, postTokens: 100 })],
  ['h3', on('hook', { type: 'hook' })],
  ['inj', on('user', { text: '<env>', injected: true })],
  ['p2', on('user', { text: 'Next' })],
  ['r3', on('request', { usage: { inputTokens: 40 }, durationMs: 7 }), { requestId: 'r3' }],
  ['d2', on('system', { type: 'turn_duration', durationMs: 500 })],
])

describe('projectRequests', () => {
  it('lists every request with recorded numbers only and its member events', () => {
    const requests = projectRequests(trace)
    expect(requests.map(entry => entry.id)).toEqual(['r1', 'r2', 'r3'])
    expect(requests[0]).toEqual({
      id: 'r1',
      seq: 3,
      ts: 30,
      agentId: 'main',
      model: 'm',
      inputTokens: 100,
      outputTokens: 10,
      eventIds: ['a1', 't1'],
    })
    expect(requests[1]).toEqual({ id: 'r2', seq: 10, ts: 100, agentId: 'sub', model: 'm', eventIds: [] })
    expect(requests[1]).not.toHaveProperty('inputTokens')
    expect(requests[2]).toMatchObject({ agentId: 'main', inputTokens: 40, durationMs: 7 })
    expect(requests[2]).not.toHaveProperty('outputTokens')
  })
})

describe('projectLanes', () => {
  it('draws the main lane and one lane per subagent with requests and markers', () => {
    const lanes = projectLanes(trace)
    expect(lanes.map(lane => [lane.id, lane.depth])).toEqual([
      ['main', 0],
      ['sub', 1],
    ])
    const [main, sub] = lanes
    expect(sub).toMatchObject({ parentId: 'main', spawnEventId: 't1', title: 'Helper' })
    expect(main!.requests.map(entry => entry.id)).toEqual(['r1', 'r3'])
    expect(sub!.requests.map(entry => entry.id)).toEqual(['r2'])
    expect(main!.markers).toEqual([
      { kind: 'prompt', eventId: 'p1', ts: 10 },
      { kind: 'failed-tool', eventId: 'x1', ts: 80, callId: 'c1', name: 'bash' },
      { kind: 'compaction', eventId: 'k1', ts: 110, trigger: 'auto', preTokens: 1000, postTokens: 100 },
      { kind: 'prompt', eventId: 'p2', ts: 140 },
    ])
    expect(sub!.markers).toEqual([{ kind: 'prompt', eventId: 's1', ts: 90 }])
  })

  it('omits compaction tokens the agent did not record and adds lanes seen only on events', () => {
    const lanes = projectLanes({
      ...synthetic([
        ['k', on('compaction', {})],
        ['o', on('assistant', {}), { agentId: 'orphan' }],
      ]),
      agents: [],
    })
    expect(lanes.map(lane => lane.id)).toEqual(['main', 'orphan'])
    expect(lanes[0]!.markers).toEqual([{ kind: 'compaction', eventId: 'k', ts: 0 }])
    expect(lanes[1]!.depth).toBe(1)
  })
})

describe('projectTurns', () => {
  it('groups by main-lane prompt, folds hook runs, and totals each turn', () => {
    const turns = projectTurns(trace)
    expect(turns.map(turn => [turn.index, turn.promptEventId])).toEqual([
      [0, undefined],
      [1, 'p1'],
      [2, 'p2'],
    ])
    expect(turns[0]!.eventIds).toEqual(['pre'])
    const turn = turns[1]!
    expect(turn.eventIds[0]).toBe('p1')
    expect(turn.eventIds.at(-1)).toBe('inj')
    expect(turn.rows).toEqual([
      { type: 'event', eventId: 'p1' },
      { type: 'event', eventId: 'p1b' },
      { type: 'event', eventId: 'r1' },
      { type: 'event', eventId: 'a1' },
      { type: 'event', eventId: 't1' },
      { type: 'hooks', eventIds: ['h1', 'h2'], count: 2 },
      { type: 'event', eventId: 'x1' },
      { type: 'event', eventId: 's1' },
      { type: 'event', eventId: 'r2' },
      { type: 'event', eventId: 'k1' },
      { type: 'hooks', eventIds: ['h3'], count: 1 },
      { type: 'event', eventId: 'inj' },
    ])
    expect(turn.totals).toEqual({ events: 13, requests: 2, inputTokens: 100, outputTokens: 10, failedTools: 1 })
    expect(turn.startTs).toBe(10)
    expect(turn.endTs).toBe(130)
    expect(turns[2]!.totals).toEqual({ events: 3, requests: 1, inputTokens: 40, failedTools: 0, durationMs: 500 })
  })

  it('falls back to request durations and returns no turns for an empty trace', () => {
    const turns = projectTurns(
      synthetic([
        ['p', on('user', {})],
        ['r', on('request', { durationMs: 3 })],
        ['r2', on('request', { durationMs: 4 })],
      ]),
    )
    expect(turns[0]!.totals.durationMs).toBe(7)
    expect(projectTurns(synthetic([]))).toEqual([])
  })

  it('folds consecutive hooks only', () => {
    const events = synthetic([
      ['a', on('hook', { type: 'hook' })],
      ['b', on('hook', { type: 'hook' })],
      ['c', on('user', {})],
      ['d', on('hook', { type: 'hook' })],
    ]).events
    expect(foldHookRuns(events)).toEqual([
      { type: 'hooks', eventIds: ['a', 'b'], count: 2 },
      { type: 'event', eventId: 'c' },
      { type: 'hooks', eventIds: ['d'], count: 1 },
    ])
  })
})

describe('hiddenAfterCompaction', () => {
  it('hides shadowed events once their compaction is reached', () => {
    expect([...hiddenAfterCompaction(trace)]).toEqual(['a1', 't1'])
    expect([...hiddenAfterCompaction(trace, 'r2')]).toEqual([])
    expect([...hiddenAfterCompaction(trace, 'k1')]).toEqual(['a1', 't1'])
    expect(hiddenAfterCompaction(trace, 'missing').size).toBe(0)
  })
})
