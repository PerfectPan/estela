import { describe, expect, it } from 'vitest'
import { parseGrokUpdates } from './index.ts'

describe('parseGrokUpdates', () => {
  it('keeps each chunk and stores the system prompt on the session', () => {
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
    expect(trace.host.id).toBe('grok')
    expect(trace.session.systemPrompt).toBe('You are Grok.')
    expect(trace.session.tools).toEqual([{ name: 'run_terminal_command' }])
    expect(trace.events.map(event => event.kind)).toEqual(['user', 'user', 'tool_call', 'tool_result'])
    expect(trace.events[0]?.payload.text).toBe('Hello ')
    expect(trace.events[1]?.payload.text).toBe('world')
    expect(trace.events[3]?.payload.output).toBe('ok')
  })
})
