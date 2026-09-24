import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fold } from '@rivus/agent-trace-kernel'
import { describeHostConformance } from '@rivus/agent-trace-kernel/conformance'
import { repoEvidence, writeOversized } from '@rivus/agent-trace-kernel/testing'
import { nodeIO } from '@rivus/agent-trace-runtime-node/io'
import { afterAll, describe, expect, it } from 'vitest'
import { codexAdapter } from './index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../fixtures/conformance')
const overRoot = mkdtempSync(join(tmpdir(), 'at-m2f-codex-'))
const overFile = writeOversized(
  overRoot,
  'rollout-over.jsonl',
  '{"timestamp":"2026-01-01T00:00:00.000Z","type":"session_meta","payload":{"session_id":"big","cwd":"/work/app"}}',
)

afterAll(() => rmSync(overRoot, { recursive: true, force: true }))

describeHostConformance(codexAdapter, {
  root,
  io: nodeIO,
  oversized: { root: overRoot, file: overFile },
  sessions: [
    {
      path: join(root, 'rollout-plain.jsonl'),
      records: 14,
      capabilities: ['requests', 'usage', 'durations', 'thinking'],
    },
    {
      path: join(root, 'rollout-token-count.jsonl'),
      records: 14,
      capabilities: ['requests', 'usage'],
    },
    {
      path: join(root, 'rollout-compaction.jsonl'),
      records: 11,
      capabilities: ['compaction', 'subagents'],
    },
    {
      path: join(root, 'rollout-subagent.jsonl'),
      records: 9,
      capabilities: ['subagents'],
    },
    {
      path: join(root, 'rollout-unknown.jsonl'),
      records: 6,
      capabilities: [],
    },
  ],
}, repoEvidence())

const load = (name: string) => codexAdapter.load({ host: 'codex', path: join(root, name) }, nodeIO, {})

describe('codex behavior', () => {
  it('emits one request per token_usage_record before the call output', async () => {
    const trace = await load('rollout-plain.jsonl')
    expect(trace.session.id).toBe('cx-plain')
    expect(trace.events.map(event => event.kind)).toEqual(['user', 'user', 'request', 'thinking', 'tool_call', 'tool_result', 'request', 'assistant', 'system'])
    const requests = trace.events.filter(event => event.kind === 'request')
    expect(requests.map(event => event.payload)).toEqual([
      { model: 'gpt-test', responseId: 'resp-1', usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 1 } },
      { model: 'gpt-test', responseId: 'resp-2', usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 0, reasoningTokens: 0 } },
    ])
    expect(trace.events.find(event => event.kind === 'tool_result')?.payload).toMatchObject({ isError: true, exitCode: 1 })
    expect(trace.events.at(-1)?.payload).toEqual({ type: 'turn_duration', durationMs: 6500 })
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['session-meta', 'turn-context', 'task-marker', 'other-usage-source', 'other-usage-source'])
    const summary = fold(trace)
    expect(summary.turns).toBe(1)
    expect(summary.durationMs).toBe(6500)
    expect(summary.contextShape).toEqual([12, 20])
    for (let index = 1; index < trace.events.length; index++)
      expect(trace.events[index]!.ts).toBeGreaterThanOrEqual(trace.events[index - 1]!.ts)
  })

  it('uses token_count before the first token_usage_record and skips empty or unchanged counts', async () => {
    const trace = await load('rollout-token-count.jsonl')
    const requests = trace.events.filter(event => event.kind === 'request')
    expect(requests.map(event => event.payload)).toEqual([
      { model: 'gpt-count', usage: { inputTokens: 4, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 0, reasoningTokens: 0 } },
      { model: 'gpt-count', usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 0, reasoningTokens: 0 } },
      { model: 'gpt-next', responseId: 'resp-3', usage: { inputTokens: 6, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } },
    ])
    expect(trace.events.map(event => event.kind)).toEqual(['user', 'request', 'thinking', 'request', 'assistant', 'user', 'request', 'assistant'])
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['session-meta', 'turn-context', 'empty-usage', 'unchanged-usage', 'turn-context', 'other-usage-source'])
  })

  it('keeps replacement history by id or by role and text, and only shadows its own agent', async () => {
    const trace = await load('rollout-compaction.jsonl')
    const shadowed = trace.events.filter(event => event.shadowedBy).map(event => event.payload.text ?? event.kind)
    expect(shadowed).toEqual(['Forget this', 'tool_call'])
    // 'msg-8' is kept by role and text although the history item carries another id.
    expect(trace.events.find(event => event.id === 'msg-8')?.shadowedBy).toBeUndefined()
    expect(trace.events.find(event => event.agentId === 'child-1')?.shadowedBy).toBeUndefined()
  })

  it('records a subagent lane, an agent message, and an injected developer message', async () => {
    const trace = await load('rollout-subagent.jsonl')
    expect(trace.agents).toContainEqual({ id: 'child-1', parentId: 'main' })
    expect(trace.events.find(event => event.payload.injected === true)?.kind).toBe('system')
    expect(trace.events.find(event => event.payload.type === 'agent_message')?.payload).toEqual({ type: 'agent_message', author: '/root/child', recipient: '/root', text: 'Done' })
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['session-meta', 'inter-agent'])
  })

  it('skips injected user text in turns and discover titles', async () => {
    const trace = await load('rollout-subagent.jsonl')
    expect(fold(trace).turns).toBe(1)
    expect(trace.session.title).toBe('Delegate')
    const titles: (string | undefined)[] = []
    for await (const head of codexAdapter.discover(root, nodeIO, {})) {
      if ('firstPrompt' in head && head.ref.path.endsWith('rollout-plain.jsonl'))
        titles.push(head.firstPrompt)
    }
    expect(titles).toEqual(['Run the tests'])
  })

  it('maps web search to a tool call, keeps unknown types, and rejects an unknown generation', async () => {
    const trace = await load('rollout-unknown.jsonl')
    expect(trace.events.filter(event => event.kind === 'unknown').map(event => event.payload.type)).toEqual(['mystery_box', 'mystery_event'])
    expect(trace.events.find(event => event.kind === 'tool_call')?.payload).toEqual({ callId: '', name: 'web_search', args: { type: 'search', query: 'vitest', queries: ['vitest'] } })
    expect(trace.events.filter(event => event.kind === 'tool_call').map(event => event.payload.name)).toEqual(['web_search', 'tool_search'])
    const result = trace.events.find(event => event.kind === 'tool_result')
    expect(result?.payload.callId).toBe('call-ts')
    expect(result?.payload.orphan).toBeUndefined()
    const bad = join(here, '../fixtures/unknown-generation/rollout-bad.jsonl')
    await expect(codexAdapter.load({ host: 'codex', path: bad }, nodeIO, {}))
      .rejects.toThrow(`codex: ${bad}:1: unknown format generation`)
  })
})
