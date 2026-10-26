import type { EventOf, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
import { toOtlp, type OtlpSpan } from './export-otlp.ts'

const SOURCE = { file: 'fixture.jsonl', offset: 0, length: 10, line: 1 }

function event(
  id: string,
  partial: Partial<TraceEvent> & Pick<TraceEvent, 'kind' | 'payload'>,
  seq: number,
): TraceEvent {
  return { ...partial, id, seq, ts: partial.ts ?? seq, source: SOURCE } as TraceEvent
}

function requestOf(
  id: string,
  seq: number,
  requestId: string,
  payload: Partial<EventOf<'request'>['payload']> = {},
): TraceEvent {
  return event(id, { kind: 'request', requestId, payload: { ...payload } }, seq)
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
    capabilities: ['requests', 'usage', 'compaction', 'systemPrompt', 'toolSchemas', 'subagents'],
    agents,
    skipped: [],
    events,
  }
}

/** Every span in the one resource/scope the export writes. */
function spansOf(trace: Trace): ReturnType<typeof toOtlp>['resourceSpans'][0]['scopeSpans'][0]['spans'] {
  return toOtlp(trace).resourceSpans[0]!.scopeSpans[0]!.spans
}

function attr(span: OtlpSpan, key: string): Record<string, unknown> | undefined {
  const value = span.attributes?.find(entry => entry.key === key)?.value
  return value === undefined ? undefined : (value as Record<string, unknown>)
}

describe('toOtlp', () => {
  it('writes one invoke_agent root, a chat span per request, and an execute_tool span per call', () => {
    const trace = traceOf([
      event('e1', { kind: 'user', payload: { text: 'List the files' } }, 0),
      event(
        'e2',
        { kind: 'tool_call', requestId: 'r1', payload: { callId: 'c1', name: 'ls', args: { path: '.' } } },
        1,
      ),
      event('e3', { kind: 'tool_result', requestId: 'r1', payload: { callId: 'c1', output: 'a.txt' } }, 2),
      event('e4', { kind: 'assistant', requestId: 'r1', payload: { text: 'Here are the files.' } }, 3),
      requestOf('e5', 4, 'r1', {
        model: 'test-model',
        responseId: 'resp_1',
        finishReason: 'end_turn',
        usage: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 8, cacheWriteTokens: 2, reasoningTokens: 4 },
        startedAt: 1000,
        durationMs: 250,
      }),
    ])
    const spans = spansOf(trace)
    // Requests are spanned before their tool calls, so a tool span can name its request.
    expect(spans.map(span => span.name)).toEqual(['invoke_agent test-agent', 'chat test-model', 'execute_tool ls'])

    const root = spans[0]!
    const chat = spans[1]!
    const tool = spans[2]!
    expect(root.parentSpanId).toBeUndefined()
    // The chat span hangs under the lane's invoke_agent root.
    expect(chat.parentSpanId).toBe(root.spanId)
    // The tool call joins the chat span of its request.
    expect(tool.parentSpanId).toBe(chat.spanId)

    // OTLP JSON encoding: 128/64-bit hex ids and nanosecond strings.
    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(root.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(root.startTimeUnixNano).toBe('0000000000')
    expect(chat.startTimeUnixNano).toBe('1000000000')
    expect(chat.endTimeUnixNano).toBe('1250000000')

    expect(attr(chat, 'gen_ai.operation.name')).toEqual({ stringValue: 'chat' })
    expect(attr(chat, 'gen_ai.request.model')).toEqual({ stringValue: 'test-model' })
    expect(attr(chat, 'gen_ai.response.id')).toEqual({ stringValue: 'resp_1' })
    expect(attr(chat, 'gen_ai.response.finish_reasons')).toEqual({
      arrayValue: { values: [{ stringValue: 'end_turn' }] },
    })
    expect(attr(chat, 'gen_ai.usage.input_tokens')).toEqual({ intValue: '30' })
    expect(attr(chat, 'gen_ai.usage.output_tokens')).toEqual({ intValue: '12' })
    expect(attr(chat, 'gen_ai.usage.cache_read.input_tokens')).toEqual({ intValue: '8' })
    expect(attr(chat, 'gen_ai.usage.cache_write.input_tokens')).toEqual({ intValue: '2' })
    expect(attr(chat, 'gen_ai.usage.reasoning.output_tokens')).toEqual({ intValue: '4' })

    expect(attr(tool, 'gen_ai.tool.name')).toEqual({ stringValue: 'ls' })
    expect(attr(tool, 'gen_ai.tool.call.id')).toEqual({ stringValue: 'c1' })
    expect(JSON.parse(String(attr(tool, 'gen_ai.tool.call.arguments')?.stringValue))).toEqual({ path: '.' })
    expect(JSON.parse(String(attr(tool, 'gen_ai.tool.call.result')?.stringValue))).toEqual('a.txt')
  })

  it('carries the model-visible surface at each request from reconstruct', () => {
    const trace = traceOf([
      event(
        's1',
        { kind: 'system', payload: { type: 'prompt_snapshot', systemPrompt: 'Be nice.', tools: [{ name: 'ls' }] } },
        0,
      ),
      event('e1', { kind: 'user', payload: { text: 'List the files' } }, 1),
      event('e2', { kind: 'tool_call', requestId: 'r1', payload: { callId: 'c1', name: 'ls', args: {} } }, 2),
      event('e3', { kind: 'tool_result', requestId: 'r1', payload: { callId: 'c1', output: 'a.txt' } }, 3),
      event('e4', { kind: 'assistant', requestId: 'r1', payload: { text: 'Done.' } }, 4),
      requestOf('e5', 5, 'r1', { model: 'test-model', usage: { inputTokens: 20 } }),
      event('e6', { kind: 'user', payload: { text: 'Now summarize' } }, 6),
      requestOf('e7', 7, 'r2', { model: 'test-model', usage: { inputTokens: 20 } }),
      event('c1', { kind: 'compaction', payload: { trigger: 'auto' } }, 8),
      event('e8', { kind: 'user', payload: { text: 'Go on' } }, 9),
      requestOf('e9', 10, 'r3', { model: 'test-model', usage: { inputTokens: 10 } }),
    ])
    trace.events.find(item => item.id === 'e2')!.shadowedBy = 'c1'
    trace.events.find(item => item.id === 'e3')!.shadowedBy = 'c1'
    trace.events.find(item => item.id === 'e4')!.shadowedBy = 'c1'
    const chats = spansOf(trace).filter(span => span.name.startsWith('chat'))
    const first = chats[0]!
    const second = chats[1]!
    const third = chats[2]!

    // The producing request sees its prompt, not its own output group.
    expect(JSON.parse(String(attr(first, 'gen_ai.input.messages')?.stringValue))).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'List the files' }] },
    ])
    expect(JSON.parse(String(attr(first, 'gen_ai.output.messages')?.stringValue))).toEqual([
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'ls', arguments: {} }] },
      { role: 'assistant', parts: [{ type: 'text', content: 'Done.' }] },
    ])
    expect(JSON.parse(String(attr(first, 'gen_ai.system_instructions')?.stringValue))).toEqual([
      { type: 'text', content: 'Be nice.' },
    ])
    expect(JSON.parse(String(attr(first, 'gen_ai.tool.definitions')?.stringValue))).toEqual([{ name: 'ls' }])
    expect(attr(first, 'gen_ai.conversation.compacted')).toBeUndefined()

    // The next request sees the earlier turn, tool call and result included.
    const secondInput = JSON.parse(String(attr(second, 'gen_ai.input.messages')?.stringValue))
    expect(secondInput.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ])

    // The request after the compaction flags it and sees the compacted surface.
    expect(attr(third, 'gen_ai.conversation.compacted')).toEqual({ boolValue: true })
    const thirdInput = JSON.parse(String(attr(third, 'gen_ai.input.messages')?.stringValue))
    expect(thirdInput.map((message: { parts: { content: string }[] }) => message.parts[0]?.content)).toEqual([
      'List the files',
      'Now summarize',
      'Go on',
    ])
  })

  it('marks an errored tool result as a failed span', () => {
    const trace = traceOf([
      event('t1', { kind: 'tool_call', payload: { callId: 'c1', name: 'run', args: {} } }, 0),
      event('t2', { kind: 'tool_result', payload: { callId: 'c1', output: 'boom', isError: true } }, 1),
    ])
    const tool = spansOf(trace).find(span => span.name.startsWith('execute_tool'))!
    expect(tool.status).toEqual({ code: 2, message: 'boom' })
  })

  it('parents a subagent invoke_agent span at its spawn event', () => {
    const trace = traceOf(
      [
        event('u1', { kind: 'user', payload: { text: 'Go' } }, 0),
        event('t1', { kind: 'tool_call', payload: { callId: 'spawn', name: 'Task', args: {} } }, 1),
        event('t2', { kind: 'tool_result', payload: { callId: 'spawn', output: 'done' } }, 2),
        event('b1', { kind: 'user', agentId: 'sub', payload: { text: 'help' } }, 3),
      ],
      [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 't1', title: 'Helper' }],
    )
    const spans = spansOf(trace)
    const sub = spans.find(span => span.name === 'invoke_agent Helper')!
    const spawnTool = spans.find(span => span.name === 'execute_tool Task')!
    expect(sub).toBeDefined()
    expect(sub.parentSpanId).toBe(spawnTool.spanId)
    expect(attr(sub, 'gen_ai.operation.name')).toEqual({ stringValue: 'invoke_agent' })
  })

  it('keeps the same ids across exports of the same trace', () => {
    const build = (): Trace =>
      traceOf([event('u1', { kind: 'user', payload: { text: 'Go' } }, 0), requestOf('r1', 1, 'g1', { model: 'm' })])
    const first = spansOf(build())
    const second = spansOf(build())
    expect(first.map(span => [span.traceId, span.spanId])).toEqual(second.map(span => [span.traceId, span.spanId]))
  })
})
