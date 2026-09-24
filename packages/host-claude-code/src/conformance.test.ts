import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryIO } from '@rivus/agent-trace-kernel'
import { describeHostConformance } from '@rivus/agent-trace-kernel/conformance'
import { describe, expect, it } from 'vitest'
import { claudeCodeAdapter } from './index.ts'

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

describeHostConformance(claudeCodeAdapter, {
  root,
  io,
  sessions: [
    {
      path: join(root, 'plain/session.jsonl'),
      records: 7,
      capabilities: ['requests', 'usage', 'durations', 'thinking', 'hooks'],
    },
    {
      path: join(root, 'compaction/session.jsonl'),
      records: 5,
      capabilities: ['compaction', 'compactionTokens'],
    },
    {
      path: join(root, 'subagent/session.jsonl'),
      files: [
        join(root, 'subagent/session.jsonl'),
        join(root, 'subagent/session/subagents/agent-helper.jsonl'),
      ],
      records: 4,
      capabilities: ['subagents'],
    },
    {
      path: join(root, 'unknown-type/session.jsonl'),
      records: 2,
      capabilities: [],
    },
  ],
}, {
  browserBundleSource: readFileSync(join(repo, 'scripts/check-browser-bundle.mjs'), 'utf8'),
  oxlintSource: readFileSync(join(repo, '.oxlintrc.json'), 'utf8'),
})

describe('claude-code behavior', () => {
  it('groups requests, maps usage, and flags a failed tool', async () => {
    const trace = await claudeCodeAdapter.load({ host: 'claude-code', path: join(root, 'plain/session.jsonl') }, io, {})
    const first = trace.events.find(event => event.kind === 'request' && event.requestId === 'req-1')
    const second = trace.events.find(event => event.kind === 'request' && event.requestId === 'req-2')
    expect(first?.payload).toMatchObject({
      model: 'claude-test',
      responseId: 'msg-1',
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 1, cacheWriteTokens: 2 },
    })
    expect(second?.payload.durationMs).toBe(1500)
    expect(trace.events.find(event => event.kind === 'tool_result')?.payload.isError).toBe(true)
    expect(trace.events.some(event => event.kind === 'hook' && event.payload.name === 'Stop')).toBe(true)
    expect(trace.events.some(event => event.kind === 'thinking')).toBe(true)
  })

  it('shadows events outside the preserved segment', async () => {
    const trace = await claudeCodeAdapter.load({ host: 'claude-code', path: join(root, 'compaction/session.jsonl') }, io, {})
    const compaction = trace.events.find(event => event.kind === 'compaction')
    expect(compaction?.payload).toMatchObject({ trigger: 'auto', preTokens: 1000, postTokens: 100 })
    const shadowed = new Set(trace.events.filter(event => event.shadowedBy).map(event => event.id))
    expect(shadowed.has('c-u1')).toBe(true)
    expect(shadowed.has('c-a1')).toBe(true)
    expect(shadowed.has('c-u2')).toBe(false)
    expect(shadowed.has('c-a2')).toBe(false)
  })

  it('keeps a subagent on the parent session', async () => {
    const trace = await claudeCodeAdapter.load({ host: 'claude-code', path: join(root, 'subagent/session.jsonl') }, io, {})
    expect(trace.agents).toContainEqual({ id: 'helper', parentId: 'main' })
    expect(trace.events.filter(event => event.agentId === 'helper').map(event => event.kind)).toEqual(['user', 'assistant', 'request'])
  })

  it('keeps an unknown record type and rejects an unknown generation', async () => {
    const trace = await claudeCodeAdapter.load({ host: 'claude-code', path: join(root, 'unknown-type/session.jsonl') }, io, {})
    expect(trace.events.find(event => event.kind === 'unknown')?.payload.type).toBe('widget')
    const bad = join(here, '../fixtures/unknown-generation/session.jsonl')
    const badIo = memoryIO({ [bad]: new Uint8Array(await readFile(bad)) })
    await expect(claudeCodeAdapter.load({ host: 'claude-code', path: bad }, badIo, {}))
      .rejects.toThrow(`claude-code: ${bad}:1: unknown format generation`)
  })
})
