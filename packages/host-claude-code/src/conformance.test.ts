import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fold, reconstruct } from '@rivus/agent-trace-kernel'
import { describeHostConformance } from '@rivus/agent-trace-kernel/conformance'
import { repoEvidence, writeOversized } from '@rivus/agent-trace-kernel/testing'
import { nodeIO } from '@rivus/agent-trace-runtime-node/io'
import { afterAll, describe, expect, it } from 'vitest'
import { claudeCodeAdapter } from './index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../../fixtures/sessions/claude-code/conformance')
const overRoot = mkdtempSync(join(tmpdir(), 'at-m2f-claude-'))
const overFile = writeOversized(
  overRoot,
  'session.jsonl',
  '{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"x"}}',
)

afterAll(() => rmSync(overRoot, { recursive: true, force: true }))

describeHostConformance(
  claudeCodeAdapter,
  {
    root,
    io: nodeIO,
    oversized: { root: overRoot, file: overFile },
    sessions: [
      {
        path: join(root, 'plain/session.jsonl'),
        records: 7,
        capabilities: ['requests', 'usage', 'durations', 'thinking', 'hooks'],
      },
      {
        path: join(root, 'compaction/session.jsonl'),
        records: 7,
        capabilities: ['compaction', 'compactionTokens'],
      },
      {
        path: join(root, 'subagent/session.jsonl'),
        files: [join(root, 'subagent/session.jsonl'), join(root, 'subagent/session/subagents/agent-helper.jsonl')],
        records: 5,
        capabilities: ['subagents'],
      },
      {
        path: join(root, 'unknown-type/session.jsonl'),
        records: 5,
        capabilities: [],
      },
      {
        path: join(root, 'regroup/session.jsonl'),
        files: [
          join(root, 'regroup/session.jsonl'),
          join(root, 'regroup/session/subagents/workflows/wf-demo/agent-nested.jsonl'),
        ],
        records: 14,
        capabilities: ['requests', 'usage', 'subagents'],
      },
      {
        path: join(root, 'prompt-snapshot/session.jsonl'),
        files: [
          join(root, 'prompt-snapshot/session.jsonl'),
          join(root, 'prompt-snapshot/session/subagents/agent-worker.jsonl'),
        ],
        records: 13,
        capabilities: ['requests', 'usage', 'subagents', 'systemPrompt', 'toolSchemas'],
      },
    ],
  },
  repoEvidence(),
)

describe('claude-code behavior', () => {
  it('groups requests, maps usage, and keeps turn duration off the request', async () => {
    const trace = await claudeCodeAdapter.load(
      { host: 'claude-code', path: join(root, 'plain/session.jsonl') },
      nodeIO,
      {},
    )
    const first = trace.events.find(event => event.kind === 'request' && event.requestId === 'req-1')
    const second = trace.events.find(event => event.kind === 'request' && event.requestId === 'req-2')
    expect(first?.payload).toMatchObject({
      model: 'claude-test',
      responseId: 'msg-1',
      stopReason: 'tool_use',
      usage: { inputTokens: 13, outputTokens: 4, cacheReadTokens: 1, cacheWriteTokens: 2 },
    })
    expect(second?.payload.durationMs).toBeUndefined()
    expect(
      trace.events.find(event => event.kind === 'system' && event.payload.type === 'turn_duration')?.payload.durationMs,
    ).toBe(1500)
    expect(fold(trace).contextShape).toEqual([13, 20])
    expect(trace.events.find(event => event.kind === 'tool_result')?.payload.isError).toBe(true)
    expect(trace.events.some(event => event.kind === 'hook' && event.payload.name === 'Stop')).toBe(true)
    expect(trace.events.some(event => event.kind === 'thinking')).toBe(true)
  })

  it('merges request id A, B, A and accounts for nested journals', async () => {
    const trace = await claudeCodeAdapter.load(
      { host: 'claude-code', path: join(root, 'regroup/session.jsonl') },
      nodeIO,
      {},
    )
    const requests = trace.events.filter(event => event.kind === 'request')
    expect(requests.map(event => event.requestId)).toEqual(['req-a', 'req-b', 'req-c'])
    expect(requests[0]?.payload.usage).toEqual({
      inputTokens: 13,
      outputTokens: 4,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
    })
    expect(trace.session.title).toBe('Grouped')
    expect(trace.events.find(event => event.agentId === 'sidechain')?.kind).toBe('user')
    expect(trace.agents).toContainEqual({ id: 'sidechain', parentId: 'main' })
    expect(trace.agents).toContainEqual({
      id: 'nested',
      parentId: 'main',
      spawnEventId: 'g-a1:1',
      title: 'Nested work',
    })
    expect(trace.events.find(event => event.id === 'n-u')?.seq).toBeLessThan(
      trace.events.find(event => event.id === 'g-b')!.seq,
    )
    const undated = trace.events.find(event => event.id === 'g-nots')
    expect(undated?.ts).toBe(Date.parse('2026-01-01T00:00:06.000Z'))
    expect(trace.events.every(event => event.ts > 0)).toBe(true)
    expect(trace.skipped.map(skip => skip.reason).toSorted()).toEqual([
      'agent-meta',
      'custom-title',
      'journal',
      'pr-link',
      'relocated',
    ])
    expect(trace.events.find(event => event.id === 'g-img')).toMatchObject({
      kind: 'user',
      payload: { image: true, mediaType: 'image/png' },
    })
    expect(trace.events.find(event => event.id === 'g-cmd')?.payload.command).toBe(true)
    expect(trace.events.find(event => event.id === 'g-int:0' || event.id === 'g-int')?.payload.injected).toBe(true)
    expect(fold(trace).turns).toBe(2)
  })

  it('shadows events outside the preserved segment', async () => {
    const trace = await claudeCodeAdapter.load(
      { host: 'claude-code', path: join(root, 'compaction/session.jsonl') },
      nodeIO,
      {},
    )
    const compaction = trace.events.find(event => event.kind === 'compaction')
    expect(compaction?.payload).toMatchObject({ trigger: 'auto', preTokens: 1000, postTokens: 100 })
    const shadowed = new Set(trace.events.filter(event => event.shadowedBy).map(event => event.id))
    expect(shadowed.has('c-u1')).toBe(true)
    expect(shadowed.has('c-a1')).toBe(true)
    expect(shadowed.has('c-u2')).toBe(false)
    expect(shadowed.has('c-a2')).toBe(false)
    expect(shadowed.has('c-side')).toBe(false)
    // The summary's timestamp is earlier than the boundary; file order keeps it after.
    const ids = trace.events.map(event => event.id)
    expect(ids.indexOf('c-sum')).toBeGreaterThan(ids.indexOf('c-b1'))
    expect(shadowed.has('c-sum')).toBe(false)
    expect(reconstruct(trace, 'request:req-c2').visibleIds).toContain('c-sum')
  })

  it('keeps a subagent on the parent session', async () => {
    const trace = await claudeCodeAdapter.load(
      { host: 'claude-code', path: join(root, 'subagent/session.jsonl') },
      nodeIO,
      {},
    )
    expect(trace.agents).toContainEqual({
      id: 'helper',
      parentId: 'main',
      spawnEventId: 'm-a1:1',
      title: 'Look around',
    })
    expect(trace.events.filter(event => event.agentId === 'helper').map(event => event.kind)).toEqual([
      'user',
      'request',
      'assistant',
    ])
  })

  it('titles a discovered session with its first real prompt', async () => {
    const heads = []
    for await (const head of claudeCodeAdapter.discover(join(root, 'unknown-type'), nodeIO, {})) {
      heads.push(head)
    }
    expect(heads).toMatchObject([{ firstPrompt: 'Hello', title: 'Hello' }])
    const trace = await claudeCodeAdapter.load(
      { host: 'claude-code', path: join(root, 'unknown-type/session.jsonl') },
      nodeIO,
      {},
    )
    expect(trace.session.title).toBe('Hello')
    expect(fold(trace).turns).toBe(1)
  })

  it('keeps an unknown record type and rejects an unknown generation', async () => {
    const trace = await claudeCodeAdapter.load(
      { host: 'claude-code', path: join(root, 'unknown-type/session.jsonl') },
      nodeIO,
      {},
    )
    expect(trace.events.find(event => event.kind === 'unknown')?.payload.type).toBe('widget')
    expect(trace.events.find(event => event.id === 'k-f1')?.payload).toEqual({
      type: 'model_refusal_fallback',
      text: 'Retried on another model.',
      originalModel: 'claude-a',
      fallbackModel: 'claude-b',
      apiRefusalCategory: 'policy',
    })
    expect(trace.events.find(event => event.id === 'k-a1')?.payload).toEqual({
      type: 'fallback',
      fromModel: 'claude-a',
      toModel: 'claude-b',
    })
    expect(trace.events.filter(event => event.kind === 'unknown').map(event => event.payload.type)).toEqual(['widget'])
    const bad = join(here, '../../../fixtures/sessions/claude-code/unknown-generation/session.jsonl')
    await expect(claudeCodeAdapter.load({ host: 'claude-code', path: bad }, nodeIO, {})).rejects.toThrow(
      `claude-code: ${bad}:1: unknown format generation`,
    )
  })
})
