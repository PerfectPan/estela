import { describe, expect, it } from 'vitest'
import { parseGrokUpdates } from './index.ts'

describe('parseGrokUpdates', () => {
  it('coalesces chunks and keeps system + tools from extras', () => {
    const trace = parseGrokUpdates([
      { timestamp: '2026-01-01T00:00:00Z', params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello ' } } } },
      { timestamp: '2026-01-01T00:00:01Z', params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'world' } } } },
      { timestamp: '2026-01-01T00:00:02Z', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'run_terminal_command', rawInput: { command: 'ls' } } } },
      { timestamp: '2026-01-01T00:00:03Z', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'ok' } }] } } },
    ], {
      sessionId: 'g1',
      cwd: '/tmp',
      systemPrompt: 'You are Grok.',
      tools: [{ name: 'run_terminal_command' }],
    })
    expect(trace.host).toBe('grok')
    expect(trace.events[0].kind).toBe('system')
    expect(trace.events[0].payload.tools).toEqual([{ name: 'run_terminal_command' }])
    expect(trace.events.map(e => e.kind)).toEqual(['system', 'user', 'tool_call', 'tool_result'])
    expect(trace.events[1].payload.text).toBe('Hello world')
    expect(trace.events[3].payload.text).toBe('ok')
  })
})
