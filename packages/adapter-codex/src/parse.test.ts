import { describe, expect, it } from 'vitest'
import { parseCodexRows } from './index.ts'

describe('parseCodexRows', () => {
  it('maps response_item rows and skips token_count', () => {
    const trace = parseCodexRows([
      { type: 'session_meta', payload: { session_id: 's1', cwd: '/tmp/app' } },
      { type: 'response_item', ordinal: 1, timestamp: '2026-01-01T00:00:00Z', payload: { type: 'message', role: 'user', content: 'fix it' } },
      { type: 'response_item', ordinal: 2, payload: { type: 'function_call', name: 'shell', arguments: '{"cmd":"ls"}', call_id: 'c1' } },
      { type: 'response_item', ordinal: 3, payload: { type: 'function_call_output', call_id: 'c1', output: 'ok' } },
      { type: 'event_msg', payload: { type: 'token_count' } },
    ])
    expect(trace.host).toBe('codex')
    expect(trace.session.id).toBe('s1')
    expect(trace.session.cwd).toBe('/tmp/app')
    expect(trace.events.map(e => e.kind)).toEqual(['user', 'tool_call', 'tool_result'])
    expect(trace.events[0].payload.text).toBe('fix it')
    expect(trace.events[1].payload.callId).toBe('c1')
  })
})
