import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryIO } from '@rivus/agent-trace-kernel'
import { describeHostConformance } from '@rivus/agent-trace-kernel/conformance'
import { describe, expect, it } from 'vitest'
import { codexAdapter } from './index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../fixtures/conformance')
const repo = join(here, '../../..')

async function loadTree(dir: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory())
        await walk(path)
      else
        out[path] = new Uint8Array(await readFile(path))
    }
  }
  await walk(dir)
  return out
}

const io = memoryIO(await loadTree(root))

describeHostConformance(codexAdapter, {
  root,
  io,
  sessions: [
    {
      path: join(root, 'rollout-plain.jsonl'),
      records: 8,
      capabilities: ['requests', 'usage', 'durations', 'thinking'],
    },
    {
      path: join(root, 'rollout-compaction.jsonl'),
      records: 5,
      capabilities: ['compaction'],
    },
    {
      path: join(root, 'rollout-subagent.jsonl'),
      records: 4,
      capabilities: ['subagents'],
    },
    {
      path: join(root, 'rollout-unknown.jsonl'),
      records: 2,
      capabilities: [],
    },
  ],
}, {
  browserBundleSource: readFileSync(join(repo, 'scripts/check-browser-bundle.mjs'), 'utf8'),
  oxlintSource: readFileSync(join(repo, '.oxlintrc.json'), 'utf8'),
})

describe('codex behavior', () => {
  it('maps usage onto the request and not onto the conversation', async () => {
    const trace = await codexAdapter.load({ host: 'codex', path: join(root, 'rollout-plain.jsonl') }, io, {})
    expect(trace.session.id).toBe('cx-plain')
    expect(trace.events.map(event => event.kind)).toEqual(['user', 'thinking', 'tool_call', 'tool_result', 'request'])
    const request = trace.events.find(event => event.kind === 'request')
    expect(request?.payload).toMatchObject({
      model: 'gpt-test',
      responseId: 'resp-1',
      durationMs: 40,
      usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 1 },
    })
    expect(trace.events.find(event => event.kind === 'tool_result')?.payload.isError).toBe(true)
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['session-meta', 'turn-context', 'task-marker'])
  })

  it('keeps replacement history and shadows the rest', async () => {
    const trace = await codexAdapter.load({ host: 'codex', path: join(root, 'rollout-compaction.jsonl') }, io, {})
    const shadowed = trace.events.filter(event => event.shadowedBy).map(event => event.id)
    expect(shadowed).toEqual(['old-1'])
    expect(trace.events.some(event => event.id === 'keep-1' && event.shadowedBy == null)).toBe(true)
    expect(trace.events.some(event => event.id === 'new-1' && event.shadowedBy == null)).toBe(true)
  })

  it('records a subagent lane', async () => {
    const trace = await codexAdapter.load({ host: 'codex', path: join(root, 'rollout-subagent.jsonl') }, io, {})
    expect(trace.agents).toContainEqual({ id: 'child-1', parentId: 'main' })
  })

  it('keeps an unknown record type and rejects an unknown generation', async () => {
    const trace = await codexAdapter.load({ host: 'codex', path: join(root, 'rollout-unknown.jsonl') }, io, {})
    expect(trace.events.find(event => event.kind === 'unknown')?.payload.type).toBe('mystery_box')
    const bad = join(here, '../fixtures/unknown-generation/rollout-bad.jsonl')
    const badIo = memoryIO({ [bad]: new Uint8Array(await readFile(bad)) })
    await expect(codexAdapter.load({ host: 'codex', path: bad }, badIo, {}))
      .rejects.toThrow(`codex: ${bad}:1: unknown format generation`)
  })
})
