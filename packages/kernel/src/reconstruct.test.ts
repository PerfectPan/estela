import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Trace, TraceEventPayloads } from '@rivus/agent-trace-schema'
import { assertTrace, isTrace } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
import { reconstruct } from './reconstruct.ts'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo.trace.json')

async function demoTrace(): Promise<Trace> {
  const value: unknown = JSON.parse(await readFile(fixturePath, 'utf8'))
  assertTrace(value, fixturePath)
  return value
}

describe('reconstruct', () => {
  it('drops shadowed events after compaction, keeps them in the archive', async () => {
    const trace: unknown = JSON.parse(await readFile(fixturePath, 'utf8'))
    expect(isTrace(trace)).toBe(true)
    if (!isTrace(trace)) {
      return
    }

    const before = reconstruct(trace, 'e3')
    expect(before.visibleIds).toContain('e3')
    expect(before.completeness).toBe('partial')

    const after = reconstruct(trace, 'e6')
    expect(after.visibleIds).not.toContain('e3')
    expect(after.visibleIds).not.toContain('e4')
    expect(after.visibleIds).toContain('e5')
    expect(trace.events.map(e => e.id)).toContain('e3')

    const request = reconstruct(trace, 'e7')
    expect(request.tokens?.map(count => [count.from, count.tokens])).toEqual([
      ['request.inputTokens', 30],
      ['compaction.postTokens', 100],
    ])
  })

  it('fills slots, recorded token counts, and the events compaction removed', async () => {
    const trace = await demoTrace()
    const request = reconstruct(trace, 'e7')
    expect(request.slots).toEqual([
      { name: 'system', status: 'unavailable', eventIds: [] },
      { name: 'tools', status: 'unavailable', eventIds: [] },
      { name: 'summary', status: 'present', eventIds: ['e5'] },
      { name: 'messages', status: 'empty', eventIds: [] },
      { name: 'currentTurn', status: 'present', eventIds: ['e2', 'e6'] },
    ])
    expect(request.tokens).toEqual([
      { slots: ['system', 'tools', 'summary', 'messages', 'currentTurn'], tokens: 30, from: 'request.inputTokens' },
      { slots: ['system', 'tools', 'summary', 'messages'], tokens: 100, from: 'compaction.postTokens' },
    ])
    expect(request.removedIds).toEqual(['e3', 'e4'])
    expect(request.unavailable).toEqual(['system', 'tools'])

    const before = reconstruct(trace, 'e4')
    expect(before.removedIds).toEqual([])
    expect(before.tokens).toEqual([])
    expect(before.slots?.find(item => item.name === 'summary')?.status).toBe('empty')
  })

  it('stays on the event lane and records no count the agent did not log', () => {
    const source = { file: 'f', offset: 0, length: 1, line: 1 }
    const trace: Trace = {
      schema: 'agent-trace',
      agent: { id: 'test' },
      session: { id: 's' },
      capabilities: ['requests'],
      agents: [{ id: 'main' }, { id: 'sub', parentId: 'main' }],
      events: [
        { id: 'p', seq: 0, ts: 0, kind: 'user', payload: { text: 'go' }, source: { ...source, line: 1 } },
        { id: 'k', seq: 1, ts: 1, kind: 'compaction', payload: { postTokens: 5 }, source: { ...source, line: 2 } },
        {
          id: 'sp',
          seq: 2,
          ts: 2,
          kind: 'user',
          agentId: 'sub',
          payload: { text: 'task' },
          source: { ...source, line: 3 },
        },
        { id: 'sr', seq: 3, ts: 3, kind: 'request', agentId: 'sub', payload: {}, source: { ...source, line: 4 } },
        { id: 'mr', seq: 4, ts: 4, kind: 'request', payload: {}, source: { ...source, line: 5 } },
      ],
      skipped: [],
    }
    const sub = reconstruct(trace, 'sr')
    expect(sub.visibleIds).toEqual(['sp', 'sr'])
    expect(sub.tokens).toEqual([])
    expect(sub.slots?.find(item => item.name === 'summary')?.status).toBe('unavailable')
    const main = reconstruct(trace, 'mr')
    expect(main.visibleIds).toEqual(['p', 'k', 'mr'])
    expect(main.tokens).toEqual([
      { slots: ['system', 'tools', 'summary', 'messages'], tokens: 5, from: 'compaction.postTokens' },
    ])
  })

  it('reports system unavailable unless the agent declares and recorded a system prompt', () => {
    const base = {
      schema: 'agent-trace' as const,
      agent: { id: 'test' },
      session: { id: 's' },
      capabilities: [] as Trace['capabilities'],
      agents: [],
      events: [
        {
          id: 's1',
          seq: 0,
          ts: 1,
          kind: 'system' as const,
          payload: { text: 'hint' },
          source: { file: 'f', offset: 0, length: 1, line: 1 },
        },
      ],
      skipped: [],
    }
    expect(reconstruct(base, 's1').unavailable).toContain('system')
    expect(reconstruct({ ...base, session: { id: 's', systemPrompt: 'p' } }, 's1').unavailable).toContain('system')
    expect(
      reconstruct({ ...base, capabilities: ['systemPrompt'], session: { id: 's', systemPrompt: 'p' } }, 's1')
        .unavailable,
    ).not.toContain('system')
  })

  it('does not invent a missing event', () => {
    const result = reconstruct(
      {
        schema: 'agent-trace',
        agent: { id: 'test' },
        session: { id: 's' },
        capabilities: [],
        agents: [],
        events: [],
        skipped: [],
      },
      'missing',
    )
    expect(result.completeness).toBe('unavailable')
    expect(result.unavailable).toContain('event')
  })

  it("starts a subagent turn at the lane start and needs the lane's own system prompt", () => {
    const source = { file: 'f', offset: 0, length: 1, line: 1 }
    const trace: Trace = {
      schema: 'agent-trace',
      agent: { id: 'test' },
      session: { id: 's', systemPrompt: 'main prompt' },
      capabilities: ['systemPrompt'],
      agents: [
        { id: 'main' },
        { id: 'sub', parentId: 'main' },
        { id: 'own', parentId: 'main', systemPrompt: 'sub prompt' },
      ],
      events: [
        {
          id: 'st',
          seq: 0,
          ts: 0,
          kind: 'tool_call',
          agentId: 'sub',
          payload: { callId: 'c-task', name: 'task' },
          source: { ...source, line: 1 },
        },
        { id: 'sa', seq: 1, ts: 1, kind: 'assistant', agentId: 'sub', payload: {}, source: { ...source, line: 2 } },
        { id: 'sr', seq: 2, ts: 2, kind: 'request', agentId: 'sub', payload: {}, source: { ...source, line: 3 } },
        { id: 'or', seq: 3, ts: 3, kind: 'request', agentId: 'own', payload: {}, source: { ...source, line: 4 } },
        { id: 'mr', seq: 4, ts: 4, kind: 'request', payload: {}, source: { ...source, line: 5 } },
      ],
      skipped: [],
    }
    const sub = reconstruct(trace, 'sr')
    expect(sub.slots?.find(item => item.name === 'currentTurn')?.eventIds).toEqual(['st', 'sa'])
    expect(sub.slots?.find(item => item.name === 'messages')?.eventIds).toEqual([])
    expect(sub.slots?.find(item => item.name === 'system')?.status).toBe('unavailable')
    expect(reconstruct(trace, 'or').slots?.find(item => item.name === 'system')?.status).toBe('present')
    expect(reconstruct(trace, 'mr').slots?.find(item => item.name === 'system')?.status).toBe('present')
  })

  it('keeps the main lane without a prompt out of the current turn', () => {
    const source = { file: 'f', offset: 0, length: 1, line: 1 }
    const trace: Trace = {
      schema: 'agent-trace',
      agent: { id: 'test' },
      session: { id: 's' },
      capabilities: [],
      agents: [{ id: 'main' }],
      events: [
        { id: 'a', seq: 0, ts: 0, kind: 'assistant', payload: {}, source: { ...source, line: 1 } },
        { id: 'r', seq: 1, ts: 1, kind: 'request', payload: {}, source: { ...source, line: 2 } },
      ],
      skipped: [],
    }
    const result = reconstruct(trace, 'r')
    expect(result.slots?.find(item => item.name === 'messages')?.eventIds).toEqual(['a'])
    expect(result.slots?.find(item => item.name === 'currentTurn')?.status).toBe('empty')
  })
  it('takes the system prompt and tools from the latest snapshot at or before the event on its lane', () => {
    const source = { file: 'f', offset: 0, length: 1, line: 1 }
    const snap = (
      id: string,
      seq: number,
      payload: TraceEventPayloads['system'],
      agentId?: string,
    ): Trace['events'][number] => ({
      id,
      seq,
      ts: seq,
      kind: 'system',
      ...(agentId ? { agentId } : {}),
      payload: { type: 'prompt_snapshot', ...payload },
      source: { ...source, line: seq + 1 },
    })
    const request = (id: string, seq: number, agentId?: string): Trace['events'][number] => ({
      id,
      seq,
      ts: seq,
      kind: 'request',
      ...(agentId ? { agentId } : {}),
      payload: {},
      source: { ...source, line: seq + 1 },
    })
    const trace: Trace = {
      schema: 'agent-trace',
      agent: { id: 'test' },
      // Session fields hold the latest snapshot; they must not leak to earlier events.
      session: { id: 's', systemPrompt: 'two', tools: [{ name: 'b' }] },
      capabilities: ['systemPrompt', 'toolSchemas'],
      agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', systemPrompt: 'sub' }, { id: 'bare', parentId: 'main' }],
      events: [
        request('r0', 0),
        snap('s1', 1, { systemPrompt: 'one' }),
        request('r1', 2),
        snap('s2', 3, { systemPrompt: 'one', tools: [{ name: 'a' }] }),
        snap('u1', 4, { systemPrompt: 'sub' }, 'sub'),
        request('ru', 5, 'sub'),
        request('rb', 6, 'bare'),
        snap('s3', 7, { systemPrompt: 'two', tools: [{ name: 'b' }] }),
        request('r2', 8),
      ],
      skipped: [],
    }
    const prompt = (id: string) =>
      (reconstruct(trace, id).slots ?? []).slice(0, 2).map(item => [item.status, item.recordedBy])
    expect(prompt('r0')).toEqual([
      ['unavailable', undefined],
      ['unavailable', undefined],
    ])
    expect(prompt('r1')).toEqual([
      ['present', 's1'],
      ['unavailable', undefined],
    ])
    expect(prompt('s2')).toEqual([
      ['present', 's2'],
      ['present', 's2'],
    ])
    expect(prompt('r2')).toEqual([
      ['present', 's3'],
      ['present', 's3'],
    ])
    expect(prompt('ru')).toEqual([
      ['present', 'u1'],
      ['unavailable', undefined],
    ])
    expect(prompt('rb')).toEqual([
      ['unavailable', undefined],
      ['unavailable', undefined],
    ])
    expect(reconstruct(trace, 'r1').unavailable).toEqual(['tools', 'summary'])
  })
})
