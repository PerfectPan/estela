import { describe, expect, it } from 'vitest'
import { parseOpenCodeSession } from './index.ts'

describe('parseOpenCodeSession', () => {
  it('maps parts and keeps parentId from the assistant message', () => {
    const trace = parseOpenCodeSession({
      sessionId: 'ses_1',
      cwd: '/tmp/app',
      title: 'Hello',
      messages: [
        { id: 'm1', time: 1, role: 'user', data: { role: 'user' } },
        { id: 'm2', time: 2, role: 'assistant', parentId: 'm1', agent: 'build', data: { role: 'assistant', parentID: 'm1' } },
      ],
      parts: [
        { id: 'p1', messageId: 'm1', time: 1, data: { type: 'text', text: 'hi' } },
        { id: 'p2', messageId: 'm2', time: 2, data: { type: 'reasoning', text: 'think' } },
        { id: 'p3', messageId: 'm2', time: 3, data: { type: 'tool', tool: 'bash', callID: 'c1', state: { status: 'running', input: { cmd: 'ls' } } } },
        { id: 'p4', messageId: 'm2', time: 4, data: { type: 'tool', tool: 'bash', callID: 'c1', state: { status: 'completed', output: 'ok' } } },
        { id: 'p5', messageId: 'm2', time: 5, data: { type: 'compaction', auto: true, tail_start_id: 'p1' } },
      ],
    })
    expect(trace.host).toBe('opencode')
    expect(trace.events.map(e => e.kind)).toEqual(['user', 'thinking', 'tool_call', 'tool_result', 'compaction'])
    expect(trace.events[1].parentId).toBe('m1')
    expect(trace.events[1].agentId).toBe('build')
    expect(trace.events[4].kind).toBe('compaction')
  })
})
