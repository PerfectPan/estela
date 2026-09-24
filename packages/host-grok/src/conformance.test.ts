import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fold } from '@rivus/agent-trace-kernel'
import { describeHostConformance } from '@rivus/agent-trace-kernel/conformance'
import { repoEvidence, writeOversized } from '@rivus/agent-trace-kernel/testing'
import { nodeIO } from '@rivus/agent-trace-runtime-node'
import { describe, expect, it } from 'vitest'
import { grokAdapter } from './index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../fixtures/conformance')
const overRoot = mkdtempSync(join(tmpdir(), 'at-m2f-grok-'))
const overFile = writeOversized(
  overRoot,
  'updates.jsonl',
  '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"x"}}}}',
)

describeHostConformance(grokAdapter, {
  root,
  io: nodeIO,
  oversized: { root: overRoot, file: overFile },
  sessions: [
    {
      path: join(root, 'plain/updates.jsonl'),
      records: 9,
      capabilities: ['requests', 'usage', 'durations', 'thinking', 'hooks', 'systemPrompt', 'toolSchemas'],
    },
    {
      path: join(root, 'compaction/updates.jsonl'),
      records: 4,
      capabilities: ['compaction', 'compactionTokens'],
    },
    {
      path: join(root, 'subagent/updates.jsonl'),
      records: 5,
      capabilities: ['subagents'],
    },
    {
      path: join(root, 'unknown-type/updates.jsonl'),
      records: 1,
      capabilities: [],
    },
  ],
}, repoEvidence())

const load = (name: string) => grokAdapter.load({ host: 'grok', path: join(root, name) }, nodeIO, {})

describe('grok behavior', () => {
  it('maps one request per turn before its output, keeps turn duration on a marker, and stores hook runs', async () => {
    const trace = await load('plain/updates.jsonl')
    expect(trace.session.systemPrompt).toContain('test agent')
    expect(trace.session.tools).toEqual([{ type: 'function', function: { name: 'shell', description: 'Run a command' } }])
    expect(trace.events.map(event => event.kind)).toEqual(['user', 'user', 'request', 'thinking', 'tool_call', 'tool_result', 'hook', 'assistant', 'system'])
    expect(trace.events.filter(event => event.kind === 'user').map(event => event.payload)).toEqual([
      { text: 'Run the tests' },
      { continued: true, text: 'now' },
    ])
    const request = trace.events.find(event => event.kind === 'request')
    expect(request?.payload).toEqual({
      model: 'grok-test',
      stopReason: 'end_turn',
      usage: { inputTokens: 15, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 1, reasoningTokens: 2 },
    })
    expect(request?.requestId).toBe('0')
    expect(trace.events.every(event => event.kind === 'request' || event.requestId === '0' || event.kind === 'system')).toBe(true)
    expect(trace.events.at(-1)?.payload).toEqual({ type: 'turn_duration', durationMs: 25 })
    expect(trace.events.find(event => event.kind === 'tool_result')?.payload.isError).toBe(true)
    expect(trace.events.find(event => event.kind === 'hook')?.payload).toEqual({
      type: 'hook_execution',
      event_name: 'PostToolUse',
      tool_name: 'shell',
      runs: [{ name: 'lint', status: 'success', elapsedMs: 5 }],
    })
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['tool-progress'])
    const summary = fold(trace)
    expect(summary.turns).toBe(1)
    expect(summary.durationMs).toBe(25)
    for (let index = 1; index < trace.events.length; index++)
      expect(trace.events[index]!.ts).toBeGreaterThanOrEqual(trace.events[index - 1]!.ts)
  })

  it('shadows events before an automatic compaction', async () => {
    const trace = await load('compaction/updates.jsonl')
    const compaction = trace.events.find(event => event.kind === 'compaction')
    expect(compaction?.payload).toEqual({ trigger: 'auto', preTokens: 500, postTokens: 80 })
    const users = trace.events.filter(event => event.kind === 'user')
    expect(users[0]?.shadowedBy).toBe(compaction?.id)
    expect(users[1]?.shadowedBy).toBeUndefined()
    expect(users[1]?.payload.injected).toBe(true)
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['compact-started'])
  })

  it('records a subagent lane from the spawn event and maps status updates', async () => {
    const trace = await load('subagent/updates.jsonl')
    expect(trace.agents).toContainEqual({ id: 'child-1', parentId: 'main', title: 'Look around', spawnEventId: 'updates.jsonl:2' })
    expect(trace.events.filter(event => event.kind === 'system').map(event => event.payload.type))
      .toEqual(['subagent_spawned', 'subagent_finished', 'goal_updated', 'memory_dream_started'])
    expect(trace.events.every(event => event.kind !== 'unknown')).toBe(true)
  })

  it('keeps an unknown record type and rejects an unknown generation', async () => {
    const trace = await load('unknown-type/updates.jsonl')
    expect(trace.events[0]?.payload.type).toBe('widget')
    const bad = join(here, '../fixtures/unknown-generation/updates.jsonl')
    await expect(grokAdapter.load({ host: 'grok', path: bad }, nodeIO, {}))
      .rejects.toThrow(`grok: ${bad}:1: unknown format generation`)
  })
})
