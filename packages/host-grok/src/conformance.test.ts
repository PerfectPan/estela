import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memoryIO } from '@rivus/agent-trace-kernel'
import { describeHostConformance } from '@rivus/agent-trace-kernel/conformance'
import { describe, expect, it } from 'vitest'
import { grokAdapter } from './index.ts'

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

describeHostConformance(grokAdapter, {
  root,
  io,
  sessions: [
    {
      path: join(root, 'plain/updates.jsonl'),
      records: 7,
      capabilities: ['requests', 'usage', 'durations', 'thinking', 'hooks', 'systemPrompt', 'toolSchemas'],
    },
    {
      path: join(root, 'compaction/updates.jsonl'),
      records: 4,
      capabilities: ['compaction', 'compactionTokens'],
    },
    {
      path: join(root, 'subagent/updates.jsonl'),
      records: 3,
      capabilities: ['subagents'],
    },
    {
      path: join(root, 'unknown-type/updates.jsonl'),
      records: 1,
      capabilities: [],
    },
  ],
}, {
  browserBundleSource: readFileSync(join(repo, 'scripts/check-browser-bundle.mjs'), 'utf8'),
  oxlintSource: readFileSync(join(repo, '.oxlintrc.json'), 'utf8'),
})

describe('grok behavior', () => {
  it('maps turn usage, a failed tool, and a hook', async () => {
    const trace = await grokAdapter.load({ host: 'grok', path: join(root, 'plain/updates.jsonl') }, io, {})
    expect(trace.session.systemPrompt).toContain('test agent')
    expect(trace.session.tools).toEqual([{ name: 'shell' }])
    const request = trace.events.find(event => event.kind === 'request')
    expect(request?.payload).toMatchObject({
      model: 'grok-test',
      stopReason: 'end_turn',
      durationMs: 25,
      usage: { inputTokens: 15, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 1, reasoningTokens: 2 },
    })
    expect(trace.events.find(event => event.kind === 'tool_result')?.payload.isError).toBe(true)
    expect(trace.events.some(event => event.kind === 'hook')).toBe(true)
    expect(trace.skipped.map(skip => skip.reason)).toEqual(['tool-progress'])
  })

  it('shadows events before an automatic compaction', async () => {
    const trace = await grokAdapter.load({ host: 'grok', path: join(root, 'compaction/updates.jsonl') }, io, {})
    const compaction = trace.events.find(event => event.kind === 'compaction')
    expect(compaction?.payload).toMatchObject({ trigger: 'auto', preTokens: 500, postTokens: 80 })
    const users = trace.events.filter(event => event.kind === 'user')
    expect(users[0]?.shadowedBy).toBe(compaction?.id)
    expect(users[1]?.shadowedBy).toBeUndefined()
  })

  it('records a subagent lane from the spawn event', async () => {
    const trace = await grokAdapter.load({ host: 'grok', path: join(root, 'subagent/updates.jsonl') }, io, {})
    expect(trace.agents).toContainEqual({ id: 'child-1', parentId: 'main', title: 'Look around', spawnEventId: 'updates.jsonl:2' })
  })

  it('keeps an unknown record type and rejects an unknown generation', async () => {
    const trace = await grokAdapter.load({ host: 'grok', path: join(root, 'unknown-type/updates.jsonl') }, io, {})
    expect(trace.events[0]?.payload.type).toBe('widget')
    const badDir = join(here, '../fixtures/unknown-generation')
    const badIo = memoryIO(await loadTree(badDir))
    const bad = join(badDir, 'updates.jsonl')
    await expect(grokAdapter.load({ host: 'grok', path: bad }, badIo, {}))
      .rejects.toThrow(`grok: ${bad}:1: unknown format generation`)
  })
})
