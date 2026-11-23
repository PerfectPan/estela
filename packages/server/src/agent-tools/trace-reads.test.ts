import type { Trace, TraceEvent } from '@rivus/estela-schema'
import { redact, redactText } from '@rivus/agent-kit/redact'
import { describe, expect, it } from 'vite-plus/test'
import { TraceIds } from './trace-ids.ts'
import { listRequests, listTurns, sessionSummary } from './trace-reads.ts'

const source = (line: number) => ({ file: 'f', offset: 0, length: 1, line })

function request(id: string, seq: number, agentId?: string): TraceEvent {
  return {
    id,
    seq,
    ts: seq + 1,
    kind: 'request',
    requestId: id,
    payload: { model: 'm', usage: { inputTokens: 10 * (seq + 1) } },
    source: source(seq + 1),
    ...(agentId ? { agentId } : {}),
  }
}

const trace: Trace = {
  schema: 'estela',
  agent: 'test',
  session: { id: 's', title: 't'.repeat(250) },
  capabilities: ['requests', 'usage'],
  agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'r1' }],
  events: [
    { id: 'u1', seq: 0, ts: 1, kind: 'user', payload: { text: 'Fix the build' }, source: source(1) },
    request('r1', 1),
    request('r2', 2, 'sub'),
    { id: 'u2', seq: 3, ts: 4, kind: 'user', payload: { text: 'Again' }, source: source(4) },
    request('r3', 4),
  ],
  skipped: [],
}
const ids = new TraceIds(trace, () => true)
const same = <T>(value: T): T => value
const plain = { value: same, text: (text: string) => text }

describe('trace reads', () => {
  it('summarizes recorded counts, names the unrecorded ones, and clips the title', () => {
    const summary = sessionSummary(trace, 't1', ids, plain)
    expect(summary.numbers).toMatchObject({ turns: 2, requests: 3, inputTokens: 100 })
    expect(summary.unavailable).toEqual(['outputTokens', 'durationMs', 'compactions', 'subagents'])
    expect(summary.lanes.map(lane => [lane.id, lane.requests, lane.spawnEventId])).toEqual([
      ['main', 2, undefined],
      ['sub', 1, 'r1'],
    ])
    expect(summary.truncated).toEqual([['title']])
  })

  it('marks a subagent lane whose log is missing as unavailable', () => {
    const withMissing: Trace = {
      ...trace,
      agents: [
        { id: 'main' },
        { id: 'lost', parentId: 'main', spawnEventId: 'r1', unavailable: true },
        { id: 'sub', parentId: 'main', spawnEventId: 'r1' },
      ],
    }
    const summary = sessionSummary(withMissing, 't1', new TraceIds(withMissing, () => true), plain)
    expect(summary.lanes.map(lane => [lane.id, lane.requests, lane.unavailable])).toEqual([
      ['main', 2, undefined],
      ['lost', 0, true],
      ['sub', 1, undefined],
    ])
    expect(summary.lanes[0]).not.toHaveProperty('unavailable')
  })

  it('lists turns with their prompts and requests by lane and turn', () => {
    const turns = listTurns(trace, 't1', ids, {}, plain)
    expect(turns.turns.map(turn => [turn.index, turn.prompt, turn.requests])).toEqual([
      [0, 'Fix the build', 2],
      [1, 'Again', 1],
    ])
    expect(listRequests(trace, 't1', ids, { lane: 'sub' }, plain).requests.map(item => item.id)).toEqual(['r2'])
    const second = listRequests(trace, 't1', ids, { turn: 1 }, plain)
    expect(second.requests.map(item => [item.id, item.turn, item.inputTokens])).toEqual([['r3', 1, 50]])
    expect(() => listRequests(trace, 't1', ids, { lane: 'nope' }, plain)).toThrow('no lane nope in t1')
  })

  it('redacts a string before cutting it, so a cut inside the home path leaves none of it', () => {
    const home = ['', 'Users', 'alice'].join('/')
    const kit = {
      value: <T>(value: T): T => redact(value, { home }),
      text: (text: string) => redactText(text, { home }),
    }
    const long = `${'x'.repeat(289)} ${home}/project`
    const hostile: Trace = {
      ...trace,
      session: { id: 's', title: `${'t'.repeat(189)} ${home}/a`, cwd: `${home}/work` },
      events: [{ id: 'u1', seq: 0, ts: 1, kind: 'user', payload: { text: long }, source: source(1) }],
    }
    const hostileIds = new TraceIds(hostile, () => true)
    const turns = listTurns(hostile, 't1', hostileIds, {}, kit)
    const summary = sessionSummary(hostile, 't1', hostileIds, kit)
    expect(turns.turns[0]!.prompt).toBe(`${'x'.repeat(289)} ~/project`)
    expect(summary.title).toBe(`${'t'.repeat(189)} ~/a`)
    expect(summary.cwd).toBe('~/work')
    expect(JSON.stringify([turns, summary])).not.toContain(home.slice(0, 9))
    // A title the kit took from the first prompt and cut to 80 characters before redaction.
    const cut = sessionSummary(
      { ...hostile, session: { id: 's', title: `${'x'.repeat(70)} ${home}/project fix it`.slice(0, 80) } },
      't1',
      hostileIds,
      kit,
    )
    expect(cut.title).toBe(`${'x'.repeat(70)} ~`)
  })
})
