import type { Trace, TraceEvent, TraceEventPayloads } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import type { ContextDiff, ContextDiffResult } from './context-diff.ts'
import { diffContext } from './context-diff.ts'
import { toView } from './view.ts'

const source = { file: 'f', offset: 0, length: 1, line: 1 }
let seq = 0
function at(id: string, extra: { agentId?: string; shadowedBy?: string } = {}) {
  const n = seq++
  return { id, seq: n, ts: n, ...extra, source: { ...source, line: n + 1 } }
}
const user = (id: string, text: string, extra: { agentId?: string; shadowedBy?: string } = {}): TraceEvent => ({
  ...at(id, extra),
  kind: 'user',
  payload: { text },
})
const reply = (id: string, extra: { agentId?: string; shadowedBy?: string } = {}): TraceEvent => ({
  ...at(id, extra),
  kind: 'assistant',
  payload: { text: id },
})
const request = (
  id: string,
  inputTokens: number | undefined,
  extra: { agentId?: string; shadowedBy?: string } = {},
): TraceEvent => ({
  ...at(id, extra),
  kind: 'request',
  payload: inputTokens === undefined ? {} : { usage: { inputTokens } },
})
const snap = (id: string, payload: TraceEventPayloads['system']): TraceEvent => ({
  ...at(id),
  kind: 'system',
  payload: { type: 'prompt_snapshot', ...payload },
})

function compared(diff: ContextDiff): ContextDiffResult {
  if (diff.status !== 'compared') {
    throw new Error(`rejected: ${diff.reason}`)
  }
  return diff
}

/** Two turns, a compaction that hides the first, a summary, and a third turn; a subagent lane runs beside. */
function compactionTrace(): Trace {
  seq = 0
  return {
    schema: 'estela',
    agent: 'test',
    session: { id: 's' },
    capabilities: ['requests', 'usage', 'compaction', 'subagents'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main' }],
    events: [
      user('p1', 'first', { shadowedBy: 'k' }),
      request('r1', 100, { shadowedBy: 'k' }),
      reply('a1', { shadowedBy: 'k' }),
      user('p2', 'second', { shadowedBy: 'k' }),
      user('sp', 'task', { agentId: 'sub' }),
      request('sr1', 10, { agentId: 'sub' }),
      reply('sa1', { agentId: 'sub' }),
      request('r2', 200, { shadowedBy: 'k' }),
      reply('a2', { shadowedBy: 'k' }),
      request('sr2', undefined, { agentId: 'sub' }),
      { ...at('k'), kind: 'compaction', payload: { trigger: 'auto', preTokens: 250, postTokens: 40 } },
      { ...at('sum'), kind: 'user', payload: { text: 'summary', compactSummary: true } },
      user('p3', 'third'),
      request('r3', 60),
      reply('a3'),
    ],
    skipped: [],
  }
}

describe('diffContext', () => {
  it('lists exactly the events shadowedBy hides when a compaction lies between the two requests', () => {
    const trace = compactionTrace()
    const diff = compared(diffContext(trace, 'r2', 'r3'))
    const hidden = trace.events.filter(event => event.shadowedBy === 'k').map(event => event.id)
    expect(diff.compacted).toEqual(hidden)
    expect(diff.compactionIds).toEqual(['k'])
    expect(diff.left).toEqual(['p1', 'a1', 'p2'])
    expect(diff.entered).toEqual(['k', 'sum', 'p3'])
    expect(diff.inputTokens).toEqual({ before: 200, after: 60, delta: -140 })
    const slot = (name: string) => diff.slots.find(item => item.name === name)
    expect(slot('summary')).toEqual({
      name: 'summary',
      change: 'compared',
      before: 'empty',
      after: 'present',
      added: ['k', 'sum'],
      removed: [],
      unchanged: [],
    })
    // p2 was this turn at r2; the compaction hid it and p3 starts the turn at r3.
    expect(slot('currentTurn')).toMatchObject({ added: ['p3'], removed: ['p2'], unchanged: [] })
    expect(slot('messages')).toMatchObject({ before: 'present', after: 'empty', removed: ['p1', 'a1'] })
  })

  it('runs from the earlier to the later event whatever order the ids come in', () => {
    const trace = compactionTrace()
    expect(diffContext(trace, 'r3', 'r2')).toEqual(diffContext(trace, 'r2', 'r3'))
  })

  it('gives an empty diff for the same request', () => {
    const diff = compared(diffContext(compactionTrace(), 'r3', 'r3'))
    expect(diff).toMatchObject({ entered: [], left: [], compacted: [], compactionIds: [] })
    expect(diff.inputTokens).toEqual({ before: 60, after: 60, delta: 0 })
    for (const item of diff.slots) {
      if (item.change === 'compared') {
        expect(item.added).toEqual([])
        expect(item.removed).toEqual([])
      }
    }
  })

  it('keeps slots the log does not record unavailable and lists no change in them', () => {
    const diff = compared(diffContext(compactionTrace(), 'r1', 'r2'))
    expect(diff.system).toEqual({ change: 'unavailable' })
    expect(diff.tools).toEqual({ change: 'unavailable' })
    expect(diff.slots.slice(0, 2)).toEqual([
      { name: 'system', change: 'unavailable', before: 'unavailable', after: 'unavailable' },
      { name: 'tools', change: 'unavailable', before: 'unavailable', after: 'unavailable' },
    ])
  })

  it('diffs two requests on a subagent lane without the main lane, and gives no delta without a recorded count', () => {
    const diff = compared(diffContext(compactionTrace(), 'sr1', 'sr2'))
    expect(diff.lane).toBe('sub')
    expect(diff.entered).toEqual(['sa1'])
    expect(diff.compacted).toEqual([])
    expect(diff.compactionIds).toEqual([])
    expect(diff.inputTokens).toEqual({ before: 10, after: undefined, delta: undefined })
    // The main lane's compaction is not on this lane: the summary slot stays empty on both sides.
    expect(diff.slots.find(item => item.name === 'summary')).toMatchObject({ before: 'empty', after: 'empty' })
  })

  it('rejects two events on different lanes and an event that is not in the trace', () => {
    expect(diffContext(compactionTrace(), 'r2', 'sr2')).toEqual({
      status: 'rejected',
      reason: 'different-lanes',
      lanes: ['main', 'sub'],
    })
    expect(diffContext(compactionTrace(), 'r2', 'nope')).toEqual({
      status: 'rejected',
      reason: 'event-not-found',
      missing: ['nope'],
    })
  })

  it('compares the system prompt and tool names by content, the same on the view trace', () => {
    seq = 0
    const read = { name: 'Read', description: 'Read a file' }
    const shell = { type: 'function', function: { name: 'shell' } }
    const trace: Trace = {
      schema: 'estela',
      agent: 'test',
      session: { id: 's' },
      capabilities: ['systemPrompt', 'toolSchemas'],
      agents: [{ id: 'main' }],
      events: [
        snap('s1', { systemPrompt: 'one', tools: [read] }),
        request('r1', 1),
        snap('s2', { systemPrompt: 'one', tools: [read] }),
        request('r2', 2),
        snap('s3', { systemPrompt: 'two', tools: [shell] }),
        request('r3', 3),
        snap('s4', { systemPrompt: 'two', tools: [{ description: 'no name' }] }),
        request('r4', 4),
      ],
      skipped: [],
    }
    for (const subject of [trace, toView(trace)]) {
      const same = compared(diffContext(subject, 'r1', 'r2'))
      expect([same.system, same.tools]).toEqual([{ change: 'same' }, { change: 'same' }])
      const changed = compared(diffContext(subject, 'r2', 'r3'))
      expect(changed.system).toEqual({ change: 'changed' })
      expect(changed.tools).toEqual({ change: 'changed', added: ['shell'], removed: ['Read'] })
      const nameless = compared(diffContext(subject, 'r3', 'r4'))
      expect(nameless.system).toEqual({ change: 'same' })
      expect(nameless.tools).toEqual({ change: 'changed', added: undefined, removed: undefined })
    }
  })

  it('does not call two prompts the view cut to the same text equal', () => {
    seq = 0
    const long = 'x'.repeat(400)
    const trace: Trace = {
      schema: 'estela',
      agent: 'test',
      session: { id: 's' },
      capabilities: ['systemPrompt'],
      agents: [{ id: 'main' }],
      events: [
        snap('s1', { systemPrompt: `${long}a` }),
        request('r1', 1),
        snap('s2', { systemPrompt: `${long}b` }),
        request('r2', 2),
      ],
      skipped: [],
    }
    const view = toView(trace, { maxString: 256 })
    expect(compared(diffContext(view, 'r1', 'r2')).system).toEqual({ change: 'changed' })
  })
})
