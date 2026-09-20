import type { Trace } from '@agent-trace/schema'
import { describe, expect, it } from 'vitest'
import { buildLedger } from './ledger.ts'

const trace: Trace = {
  schema: 'agent-trace/v0',
  host: 'demo',
  session: { id: 's' },
  events: [
    { id: 'e1', ts: 1, kind: 'system', payload: { text: 'sys' }, original: {} },
    { id: 'e2', ts: 2, kind: 'user', payload: { text: 'fix it' }, original: {} },
    { id: 'e3', ts: 3, kind: 'tool_call', payload: { name: 'bash', callId: 'c1', args: { cmd: 'ls' } }, original: {} },
    { id: 'e4', ts: 4, kind: 'tool_result', payload: { callId: 'c1', text: 'ok' }, original: {} },
    { id: 'e5', ts: 5, kind: 'assistant', payload: { text: 'done' }, original: {} },
  ],
}

describe('buildLedger', () => {
  it('pairs tool call/result and starts a turn on user', () => {
    const sections = buildLedger(trace)
    expect(sections.map(s => s.title)).toEqual(['Between turns', 'Turn 1'])
    expect(sections[1].rows.map(r => r.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(sections[1].rows[1].eventIds).toEqual(['e3', 'e4'])
    expect(sections[1].rows[1].resultPreview).toBe('ok')
  })
})
