import type * as z from 'zod/mini'
import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import { assertTrace, isTrace, traceEventSchema, traceSchema } from './index.ts'
import { payloadSchemas, type EventKind, type Trace, type TraceEvent, type TraceEventPayloads } from './types.ts'

const source = { file: 'f', offset: 0, length: 1, line: 1 }

function event(kind: string, payload: unknown) {
  return { id: 'e', seq: 0, ts: 1, kind, payload, source }
}

function trace(events: unknown[]) {
  return {
    schema: 'agent-trace',
    agent: 'demo',
    session: { id: 's' },
    capabilities: [],
    agents: [],
    events,
    skipped: [],
  }
}

const accepts = (kind: string, payload: unknown) => traceEventSchema.safeParse(event(kind, payload)).success

/** One payload per kind in the shape the kit's adapters write it, each with a field the kit does not declare. */
const KIT_SHAPES: { [K in EventKind]: TraceEventPayloads[K] } = {
  user: { text: 'hi', meta: true, compactSummary: false, command: false, injected: false, continued: false, extra: 1 },
  assistant: { text: 'reply', image: true, mediaType: 'image/png', extra: [1] },
  reasoning: { text: 'thinking', redacted: false, extra: null },
  tool_call: { callId: 'c', name: 'Bash', title: 'Run', args: { command: 'ls' }, extra: 'x' },
  tool_result: { callId: 'c', output: ['any'], isError: true, exitCode: 1, orphan: false, extra: {} },
  request: {
    model: 'm',
    responseId: 'r',
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: 0,
    },
    startedAt: 1,
    durationMs: 2,
    finishReason: 'stop',
    granularity: 'turn',
    modelCalls: 2,
    usageByModel: { m: { usage: { inputTokens: 1 }, modelCalls: 2 } },
    extra: true,
  },
  system: {
    type: 'prompt_snapshot',
    text: 't',
    durationMs: 1,
    systemPrompt: 'p',
    tools: [{ name: 'Read' }],
    cliPrefix: 'c',
  },
  compaction: { trigger: 'auto', preTokens: 10, postTokens: 2, summaryEventId: 'e2', extra: 0 },
  hook: { type: 'hook_success', name: 'PreToolUse:Bash', event: 'PreToolUse', exitCode: 0, runs: [] },
  unknown: { type: 'mystery', extra: 'kept' },
}

describe('payload schemas', () => {
  it('accept every payload of the kit type for their kind, plus the view fields', () => {
    expectTypeOf<TraceEventPayloads['user']>().toExtend<z.input<typeof payloadSchemas.user>>()
    expectTypeOf<TraceEventPayloads['assistant']>().toExtend<z.input<typeof payloadSchemas.assistant>>()
    expectTypeOf<TraceEventPayloads['reasoning']>().toExtend<z.input<typeof payloadSchemas.reasoning>>()
    expectTypeOf<TraceEventPayloads['tool_call']>().toExtend<z.input<typeof payloadSchemas.tool_call>>()
    expectTypeOf<TraceEventPayloads['tool_result']>().toExtend<z.input<typeof payloadSchemas.tool_result>>()
    expectTypeOf<TraceEventPayloads['request']>().toExtend<z.input<typeof payloadSchemas.request>>()
    expectTypeOf<TraceEventPayloads['system']>().toExtend<z.input<typeof payloadSchemas.system>>()
    expectTypeOf<TraceEventPayloads['compaction']>().toExtend<z.input<typeof payloadSchemas.compaction>>()
    expectTypeOf<TraceEventPayloads['hook']>().toExtend<z.input<typeof payloadSchemas.hook>>()
    expectTypeOf<TraceEventPayloads['unknown']>().toExtend<z.input<typeof payloadSchemas.unknown>>()
    expectTypeOf<TraceEvent>().toExtend<z.input<typeof traceEventSchema>>()
    expectTypeOf<Trace>().toExtend<z.input<typeof traceSchema>>()
  })

  it("accept each kind in the kit's shape and keep the fields the kit does not declare", () => {
    for (const [kind, payload] of Object.entries(KIT_SHAPES)) {
      const parsed = traceEventSchema.safeParse(event(kind, payload))
      expect(parsed.success, kind).toBe(true)
      expect(parsed.data?.payload, kind).toEqual(payload)
    }
  })

  it('reject a payload that does not match its kind', () => {
    expect(accepts('tool_call', { name: 'Bash' })).toBe(false)
    expect(accepts('tool_result', { output: 'x' })).toBe(false)
    expect(accepts('hook', { name: 'PreToolUse' })).toBe(false)
    expect(accepts('unknown', {})).toBe(false)
    expect(accepts('request', { usage: { inputTokens: '12' } })).toBe(false)
    expect(accepts('request', { usageByModel: { m: { modelCalls: 1 } } })).toBe(false)
    expect(accepts('compaction', { trigger: 'sometimes' })).toBe(false)
    expect(accepts('user', { meta: 'yes' })).toBe(false)
    expect(accepts('system', { tools: {} })).toBe(false)
    expect(accepts('user', [])).toBe(false)
    expect(accepts('user', 'text')).toBe(false)
  })

  it('accept the fields a view trace adds', () => {
    expect(accepts('tool_result', { callId: 'c', output: 'x', $truncated: [['output'], ['nested', 0, 'key']] })).toBe(
      true,
    )
    expect(
      accepts('system', {
        type: 'prompt_snapshot',
        systemPromptSameAs: 'e1',
        toolsSameAs: 'e1',
        $truncated: [['systemPrompt']],
      }),
    ).toBe(true)
    expect(accepts('tool_result', { callId: 'c', $truncated: [[true]] })).toBe(false)
    expect(accepts('system', { systemPromptSameAs: 1 })).toBe(false)
  })
})

describe('isTrace and assertTrace', () => {
  it('reject a trace with one bad payload', () => {
    const bad = trace([event('user', { text: 'hi' }), event('tool_call', { callId: 'c' })])
    expect(isTrace(bad)).toBe(false)
    expect(() => assertTrace(bad, 'load')).toThrow(new TypeError('load: events.1.payload.name: Invalid input'))
  })

  it('pass the value on unchanged: same object, same key order', () => {
    const payload = { zeta: 1, callId: 'c', alpha: 2, name: 'Bash' }
    const value: unknown = trace([event('tool_call', payload)])
    assertTrace(value, 'load')
    expect(isTrace(value)).toBe(true)
    const kept = value.events[0]!
    expect(kept.payload).toBe(payload)
    expect(Object.keys(kept.payload)).toEqual(['zeta', 'callId', 'alpha', 'name'])
  })

  it('name the root issue without a path', () => {
    expect(() => assertTrace('nope', 'view')).toThrow(new TypeError('view: Invalid input'))
  })
})
