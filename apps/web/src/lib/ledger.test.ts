import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { buildLedger } from './ledger.ts'

const source = { file: 'fixture.json', offset: 0, length: 1, line: 1 }

function event(partial: Partial<TraceEvent> & Pick<TraceEvent, 'id' | 'kind' | 'payload'>): TraceEvent {
  return { seq: 0, ts: 1, source, original: {}, ...partial }
}

const trace: Trace = {
  schema: 'agent-trace',
  host: { id: 'demo' },
  session: { id: 's' },
  capabilities: [],
  agents: [],
  skipped: [],
  events: [
    event({ id: 'e1', ts: 1, kind: 'system', payload: { text: 'sys' } }),
    event({ id: 'e2', ts: 2, kind: 'user', payload: { text: 'fix it' } }),
    event({ id: 'e3', ts: 3, kind: 'tool_call', payload: { name: 'bash', callId: 'c1', args: { cmd: 'ls' } } }),
    event({ id: 'e4', ts: 4, kind: 'tool_result', payload: { callId: 'c1', text: 'ok' } }),
    event({ id: 'e5', ts: 5, kind: 'assistant', payload: { text: 'done' } }),
  ],
}

describe('buildLedger', () => {
  it('pairs tool call/result and starts a turn on user', () => {
    const sections = buildLedger(trace)
    expect(sections.map(s => s.title)).toEqual(['Between turns', 'Turn 1'])
    expect(sections[1]?.rows.map(r => r.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(sections[1]?.rows[1]?.eventIds).toEqual(['e3', 'e4'])
    expect(sections[1]?.rows[1]?.resultPreview).toBe('ok')
  })

  it('shows request usage and compaction tokens', () => {
    const sections = buildLedger({
      ...trace,
      events: [
        event({ id: 'c', kind: 'compaction', payload: { preTokens: 1000, postTokens: 100 } }),
        event({ id: 'r', kind: 'request', payload: { model: 'demo-model', usage: { inputTokens: 30, outputTokens: 12 } } }),
        event({ id: 'h', kind: 'hook', payload: { name: 'Stop', type: 'hook_success' } }),
      ],
    })
    const rows = sections.flatMap(section => section.rows)
    expect(rows.map(row => row.kind)).toEqual(['compacted', 'request', 'hook'])
    expect(rows[0]?.preview).toBe('1000 → 100 tokens')
    expect(rows[1]?.preview).toBe('demo-model in 30 out 12')
    expect(rows[2]?.preview).toBe('Stop')
  })
})
