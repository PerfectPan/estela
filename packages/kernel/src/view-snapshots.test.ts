import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { reconstruct } from './reconstruct.ts'
import { toView } from './view.ts'

const source = { file: 'f', offset: 0, length: 1, line: 1 }
const event = (id: string, seq: number, kind: TraceEvent['kind'], payload: Record<string, unknown>, agentId?: string): TraceEvent =>
  ({ id, seq, ts: seq, kind, ...(agentId ? { agentId } : {}), payload, source: { ...source, line: seq + 1 } })
const snap = (id: string, seq: number, payload: Record<string, unknown>, agentId?: string) =>
  event(id, seq, 'system', { type: 'prompt_snapshot', ...payload }, agentId)

const toolsA = [{ name: 'Read', schema: { input_schema: { type: 'object' } } }]
const toolsB = [...toolsA, { name: 'Grep' }]

function trace(): Trace {
  return {
    schema: 'agent-trace',
    host: { id: 'test' },
    session: { id: 's', systemPrompt: 'two', tools: toolsB },
    capabilities: ['systemPrompt', 'toolSchemas'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', systemPrompt: 'one' }],
    events: [
      snap('p1', 0, { systemPrompt: 'one' }),
      event('r1', 1, 'request', {}),
      snap('p2', 2, { systemPrompt: 'one', tools: toolsA, cliPrefix: 'x' }),
      snap('s1', 3, { systemPrompt: 'one' }, 'sub'),
      event('rs', 4, 'request', {}, 'sub'),
      snap('p3', 5, { systemPrompt: 'one', tools: toolsA }),
      event('r2', 6, 'request', {}),
      snap('p4', 7, { systemPrompt: 'two', tools: toolsB }),
      snap('p5', 8, { systemPrompt: 'two', tools: [] }),
      event('r3', 9, 'request', {}),
    ],
    skipped: [],
  }
}

describe('toView prompt snapshots', () => {
  it('keeps each distinct prompt and tool list once, on its first snapshot in the trace', () => {
    const view = toView(trace())
    const payload = (id: string) => view.events.find(item => item.id === id)!.payload
    expect(payload('p1')).toEqual({ type: 'prompt_snapshot', systemPrompt: 'one' })
    expect(payload('p2')).toEqual({ type: 'prompt_snapshot', systemPromptSameAs: 'p1', tools: toolsA, cliPrefix: 'x', $truncated: [['systemPrompt']] })
    // Another lane with the same prompt refers to the first holder too.
    expect(payload('s1')).toEqual({ type: 'prompt_snapshot', systemPromptSameAs: 'p1', $truncated: [['systemPrompt']] })
    expect(payload('p3')).toEqual({ type: 'prompt_snapshot', systemPromptSameAs: 'p1', toolsSameAs: 'p2', $truncated: [['systemPrompt'], ['tools']] })
    expect(payload('p4')).toEqual({ type: 'prompt_snapshot', systemPrompt: 'two', tools: toolsB })
    // An empty list is kept as is.
    expect(payload('p5')).toEqual({ type: 'prompt_snapshot', systemPromptSameAs: 'p4', tools: [], $truncated: [['systemPrompt']] })
  })

  it('reconstructs the same result from the full trace and the view', () => {
    const full = trace()
    const view = toView(full)
    for (const item of full.events)
      expect(reconstruct(view, item.id), item.id).toEqual(reconstruct(full, item.id))
  })

  it('treats a recorded empty tool list as empty, not present', () => {
    const tools = (id: string) => reconstruct(trace(), id).slots?.find(slot => slot.name === 'tools')
    expect(tools('r2')).toMatchObject({ status: 'present', recordedBy: 'p3' })
    expect(tools('r3')).toMatchObject({ status: 'empty', recordedBy: 'p5' })
    const bare: Trace = { ...trace(), events: [event('r', 0, 'request', {})], session: { id: 's', tools: [] } }
    expect(reconstruct(bare, 'r').slots?.find(slot => slot.name === 'tools')?.status).toBe('empty')
  })
})
