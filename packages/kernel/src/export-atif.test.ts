import type { EventOf, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
import { toAtif } from './export-atif.ts'

const SOURCE = { file: 'fixture.jsonl', offset: 0, length: 10, line: 1 }

/** One event with derived seq, so tests list only what matters. */
function event(
  id: string,
  partial: Partial<TraceEvent> & Pick<TraceEvent, 'kind' | 'payload'>,
  seq: number,
): TraceEvent {
  return { ...partial, id, seq, ts: partial.ts ?? seq, source: SOURCE } as TraceEvent
}

function traceOf(
  events: TraceEvent[],
  agents: Trace['agents'] = [{ id: 'main' }],
  session: Trace['session'] = { id: 's1' },
): Trace {
  return {
    schema: 'agent-trace',
    agent: 'test-agent',
    session,
    capabilities: ['requests', 'usage', 'compaction', 'subagents'],
    agents,
    skipped: [],
    events,
  }
}

function requestOf(
  id: string,
  seq: number,
  requestId: string,
  payload: Partial<EventOf<'request'>['payload']> = {},
): TraceEvent {
  return event(id, { kind: 'request', requestId, payload: { ...payload } }, seq)
}

describe('toAtif', () => {
  it('maps the demo shape: user step, agent step, compaction boundary, kept steps marked', () => {
    const trace = traceOf([
      event('e1', { kind: 'user', payload: { text: 'Fix the bug' } }, 0),
      event(
        'e2',
        { kind: 'tool_call', shadowedBy: 'e6', payload: { callId: 'c1', name: 'read', args: { path: 'a.ts' } } },
        1,
      ),
      event('e3', { kind: 'tool_result', shadowedBy: 'e6', payload: { callId: 'c1', output: 'ok' } }, 2),
      requestOf('e4', 3, 'r1', { model: 'test-model', usage: { inputTokens: 30, outputTokens: 12 } }),
      event('e5', { kind: 'assistant', requestId: 'r1', payload: { text: 'Reading it.' } }, 4),
      event('e6', { kind: 'compaction', payload: { trigger: 'auto', preTokens: 1000, postTokens: 100 } }, 5),
      event('e7', { kind: 'user', payload: { text: 'Continue' } }, 6),
      event('e8', { kind: 'assistant', requestId: 'r2', payload: { text: 'Done.' } }, 7),
      requestOf('e9', 8, 'r2', { model: 'test-model', usage: { inputTokens: 10, outputTokens: 5 } }),
    ])
    const atif = toAtif(trace)

    expect(atif.schema_version).toBe('ATIF-v1.8')
    expect(atif.session_id).toBe('s1')
    expect(atif.agent).toEqual({ name: 'test-agent', version: 'unknown', model_name: 'test-model' })
    expect(atif.steps.map(step => step.step_id)).toEqual([1, 2, 3, 4, 5])

    const [user, agent, compaction, secondUser, second] = atif.steps
    expect(user).toMatchObject({ source: 'user', message: 'Fix the bug' })
    expect(user?.extra?.agent_trace?.eventIds).toEqual(['e1'])

    // Events the compaction removed produce no step content: the surviving turn keeps
    // its assistant text and its request metrics, marked as copied context.
    expect(agent).toMatchObject({ source: 'agent', message: 'Reading it.' })
    expect(agent?.tool_calls).toBeUndefined()
    expect(agent?.observation).toBeUndefined()
    expect(agent?.metrics).toMatchObject({ prompt_tokens: 30, completion_tokens: 12 })
    expect(agent?.extra?.agent_trace?.requestId).toBe('r1')
    expect(agent?.extra?.agent_trace?.eventIds).toEqual(['e4', 'e5'])

    expect(compaction).toMatchObject({
      source: 'system',
      message: 'Context compaction performed',
      extra: { context_management: { type: 'compaction', boundary: 'replace' } },
    })

    expect(user?.is_copied_context).toBe(true)
    expect(agent?.is_copied_context).toBe(true)
    expect(secondUser?.is_copied_context).toBeUndefined()
    expect(second?.is_copied_context).toBeUndefined()

    expect(atif.final_metrics).toEqual({
      total_prompt_tokens: 40,
      total_completion_tokens: 17,
      total_steps: 5,
    })
  })

  it('puts a compaction summary in the boundary step when the trace records one', () => {
    const trace = traceOf([
      event('u1', { kind: 'user', payload: { text: 'Go' } }, 0),
      event('s1', { kind: 'user', payload: { text: 'Summary so far.', compactSummary: true } }, 1),
      event('c1', { kind: 'compaction', payload: { trigger: 'auto', summaryEventId: 's1' } }, 2),
    ])
    const atif = toAtif(trace)
    const compaction = atif.steps.find(step => step.extra?.context_management !== undefined)
    expect(compaction?.message).toBe('Summary so far.')
    expect(compaction?.observation?.results).toEqual([{ content: 'Summary so far.' }])
  })

  it('embeds each subagent lane and references it from the spawn step', () => {
    const trace = traceOf(
      [
        event('u1', { kind: 'user', payload: { text: 'Go' } }, 0),
        event('t1', { kind: 'tool_call', payload: { callId: 'spawn', name: 'Task', args: { prompt: 'help' } } }, 1),
        event('r1', { kind: 'tool_result', payload: { callId: 'spawn', output: 'child done' } }, 2),
        event('a1', { kind: 'assistant', requestId: 'q1', payload: { text: 'All done.' } }, 3),
        requestOf('q1', 4, 'q1'),
      ],
      [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 't1', title: 'Helper' }],
    )
    const subEvents: TraceEvent[] = [
      event('b1', { kind: 'user', agentId: 'sub', payload: { text: 'help' } }, 5),
      event('b2', { kind: 'assistant', agentId: 'sub', requestId: 'q2', payload: { text: 'Child work.' } }, 6),
      requestOf('b3', 7, 'q2', { model: 'child-model' }),
      trace.events[0] as TraceEvent,
    ]
    const full: Trace = { ...trace, events: [...trace.events.slice(0, 4), ...subEvents.slice(0, 3)] }
    const atif = toAtif(full)

    expect(atif.subagent_trajectories).toHaveLength(1)
    const sub = atif.subagent_trajectories![0]!
    expect(sub.trajectory_id).toBe('sub')
    expect(sub.session_id).toBe('s1')
    expect(sub.steps.map(step => step.message)).toEqual(['help', 'Child work.'])
    expect(sub.agent.name).toBe('test-agent')

    const spawnStep = atif.steps.find(step => step.tool_calls?.some(call => call.tool_call_id === 'spawn'))
    expect(spawnStep?.observation?.results).toEqual([
      { source_call_id: 'spawn', content: 'child done' },
      { source_call_id: 'spawn', subagent_trajectory_ref: [{ trajectory_id: 'sub', session_id: 's1' }] },
    ])
  })

  it('maps recorded fields only, wraps non-object arguments, and keeps hooks in extra', () => {
    const trace = traceOf([
      event('u1', { kind: 'user', payload: { text: 'Go', meta: true } }, 0),
      event('t1', { kind: 'tool_call', payload: { callId: 'c1', name: 'run', args: 'ls -la' } }, 1),
      event('h1', { kind: 'hook', payload: { type: 'tool', name: 'PreToolUse', exitCode: 0 } }, 2),
      requestOf('r1', 3, 'g1', { usage: { inputTokens: 5 }, modelCalls: 3, granularity: 'turn', responseId: 'resp_1' }),
    ])
    const atif = toAtif(trace)
    expect(atif.steps).toHaveLength(2)
    const agent = atif.steps[1]!
    expect(agent.tool_calls![0]!.arguments).toEqual({ input: 'ls -la' })
    expect(agent.llm_call_count).toBe(3)
    expect(agent.metrics?.prompt_tokens).toBe(5)
    expect(agent.metrics?.extra?.agent_trace).toMatchObject({
      responseId: 'resp_1',
      granularity: 'turn',
      modelCalls: 3,
    })
    expect(agent.extra?.agent_trace?.hooks).toEqual([{ type: 'tool', name: 'PreToolUse', exitCode: 0 }])
    expect(atif.steps[0]!.extra?.agent_trace?.flags).toEqual(['meta'])
    // No output tokens recorded, so none exported.
    expect(agent.metrics?.completion_tokens).toBeUndefined()
  })

  it('attaches an orphan tool result without a source_call_id', () => {
    const trace = traceOf([
      event('t1', { kind: 'tool_result', payload: { callId: 'ghost', output: 'late', orphan: true } }, 0),
    ])
    const atif = toAtif(trace)
    expect(atif.steps).toHaveLength(1)
    expect(atif.steps[0]!.source).toBe('agent')
    expect(atif.steps[0]!.observation?.results).toEqual([{ content: 'late', extra: { agent_trace: { orphan: true } } }])
  })

  it('builds system steps from snapshots and turn durations go to extra', () => {
    const trace = traceOf([
      event('s1', { kind: 'system', payload: { type: 'prompt_snapshot', systemPrompt: 'Be nice.' } }, 0),
      event('u1', { kind: 'user', payload: { text: 'Hi' } }, 1),
      event('a1', { kind: 'assistant', requestId: 'g1', payload: { text: 'Hello.' } }, 2),
      event('d1', { kind: 'system', payload: { type: 'turn_duration', durationMs: 42 } }, 3),
    ])
    const atif = toAtif(trace)
    expect(atif.steps[0]).toMatchObject({ source: 'system', message: 'Be nice.' })
    expect(atif.steps).toHaveLength(3)
    const agent = atif.steps[2]!
    expect(agent.extra?.agent_trace?.turnDurationMs).toBe(42)
  })

  it('throws when a trace has nothing an ATIF step can come from', () => {
    expect(() => toAtif(traceOf([]))).toThrow('No events an ATIF step can come from')
  })

  it('keeps a session prompt when the trace has no events', () => {
    const trace = traceOf([], [{ id: 'main' }], { id: 's1', systemPrompt: 'You are an agent.' })
    const atif = toAtif(trace)
    expect(atif.steps).toHaveLength(1)
    expect(atif.steps[0]).toMatchObject({ source: 'system', message: 'You are an agent.' })
  })
})
