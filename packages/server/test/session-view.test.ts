import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { fold, projectLanes, reconstruct, summaryOf, toView } from '@rivus/estela-kernel'
import { describe, expect, it } from 'vite-plus/test'
import { summarizeRow } from '../src/catalog/rows.ts'
import { loadSession } from '../src/sessions/load-session.ts'
import { toKitPath } from '../src/sessions/session-target.ts'
import { transcriptToTrace } from '../src/sessions/transcript-trace.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')
/** This system's spelling (`\\` on Windows), so `loadSession` and `summarizeRow` turn it into the kit's form. */
const fixture = (agent: string, relative: string): string =>
  join(repo, 'fixtures/sessions', agent, 'conformance', relative)
const platform = createNodePlatform()

const claudeLoad = async (relative: string) =>
  loadSession({ agent: 'claude-code', path: fixture('claude-code', relative) }, { platform })

/** Every moved fixture session, by agent and path under its conformance root. */
const FIXTURES: readonly (readonly [string, string])[] = [
  ['claude-code', 'plain/session.jsonl'],
  ['claude-code', 'compaction/session.jsonl'],
  ['claude-code', 'subagent/session.jsonl'],
  ['claude-code', 'unknown-type/session.jsonl'],
  ['claude-code', 'regroup/session.jsonl'],
  ['claude-code', 'prompt-snapshot/session.jsonl'],
  ['codex', 'rollout-plain.jsonl'],
  ['codex', 'rollout-token-count.jsonl'],
  ['codex', 'rollout-compaction.jsonl'],
  ['codex', 'rollout-subagent.jsonl'],
  ['codex', 'rollout-unknown.jsonl'],
  ['grok', 'plain/updates.jsonl'],
  ['grok', 'compaction/updates.jsonl'],
  ['grok', 'subagent/updates.jsonl'],
  ['grok', 'unknown-type/updates.jsonl'],
]

/** The system and tools slots of one request's reconstruction: name, status, recording snapshot. */
function promptSlots(trace: Awaited<ReturnType<typeof claudeLoad>>, eventId: string) {
  return (reconstruct(trace, eventId).slots ?? [])
    .filter(slot => slot.name === 'system' || slot.name === 'tools')
    .map(slot => [slot.name, slot.status, slot.recordedBy])
}

describe('catalog summary equals the workspace header summary', () => {
  // The list runs the kit adapter's summarize pass through `summarizeRow`; the workspace
  // header sums the canonical `Trace` the kit's output maps to (`fold` through the TraceStore).
  // One number family: the two paths must agree on every fixture.
  for (const [agent, relative] of FIXTURES) {
    it(`${agent} ${relative}`, async () => {
      const path = fixture(agent, relative)
      // The kit's own call: it gets the path in the form the server hands it.
      const loaded = await loadTranscript(platform, { agent, path: toKitPath(path) })
      if (!loaded.ok) {
        throw new Error(`${path}: ${loaded.error._tag}`)
      }
      const listed = await summarizeRow(platform, undefined, { agent, path })
      if (!('summary' in listed)) {
        throw new Error(`${path}: ${listed.error.reason}`)
      }
      expect(listed.summary).toEqual(summaryOf(fold(transcriptToTrace(loaded.value))))
    })
  }
})

describe('view rules on the loaded fixtures', () => {
  it('shows slots, recorded counts, and removed events at the first request after a compaction', async () => {
    const trace = await claudeLoad('compaction/session.jsonl')
    const requests = trace.events.filter(event => event.kind === 'request')
    const compaction = trace.events.find(event => event.kind === 'compaction')!
    const first = requests.find(event => event.seq > compaction.seq)!
    const result = reconstruct(trace, first.id)

    expect(result.slots?.map(slot => [slot.name, slot.status])).toEqual([
      ['system', 'unavailable'],
      ['tools', 'unavailable'],
      ['summary', 'present'],
      ['messages', 'empty'],
      ['currentTurn', 'present'],
    ])
    expect(result.slots?.find(slot => slot.name === 'summary')?.eventIds).toEqual([compaction.id, 'c-sum'])
    expect(result.slots?.find(slot => slot.name === 'currentTurn')?.eventIds).toEqual(['c-u2'])
    expect(result.tokens).toEqual([
      { slots: ['system', 'tools', 'summary', 'messages', 'currentTurn'], tokens: 40, from: 'request.inputTokens' },
      { slots: ['system', 'tools', 'summary', 'messages'], tokens: 100, from: 'compaction.postTokens' },
    ])
    expect(result.removedIds).toEqual(['c-u1', requests[0]!.id, 'c-a1'])
    expect(result.visibleIds).not.toContain('c-side')

    const [main] = projectLanes(trace)
    expect(main!.markers).toContainEqual({
      kind: 'compaction',
      eventId: compaction.id,
      ts: compaction.ts,
      trigger: 'auto',
      preTokens: 1000,
      postTokens: 100,
    })
    expect(main!.requests.map(entry => entry.inputTokens)).toEqual([100, 40])
  })

  it('the latest prompt snapshot at or before each request on its lane selects system and tools', async () => {
    const trace = await claudeLoad('prompt-snapshot/session.jsonl')
    // Only the systemPrompt-only snapshot precedes the first request: tools are not recorded yet.
    expect(promptSlots(trace, 'request:req-p1')).toEqual([
      ['system', 'present', 'p-s1'],
      ['tools', 'unavailable', undefined],
    ])
    expect(promptSlots(trace, 'request:req-p2')).toEqual([
      ['system', 'present', 'p-s2'],
      ['tools', 'present', 'p-s2'],
    ])
    // The prompt changed mid-session.
    expect(promptSlots(trace, 'request:req-p4')).toEqual([
      ['system', 'present', 'p-s3'],
      ['tools', 'present', 'p-s3'],
    ])
    // The subagent lane has its own systemPrompt-only snapshot and never sees the main lane's.
    expect(promptSlots(trace, 'request:req-w1')).toEqual([
      ['system', 'present', 'w-s1'],
      ['tools', 'unavailable', undefined],
    ])
  })

  it('reconstructs the same result from the view trace, which keeps each repeated prompt once', async () => {
    const trace = await claudeLoad('prompt-snapshot/session.jsonl')
    const view = toView(trace, { maxString: 256 })
    for (const event of trace.events) {
      expect(reconstruct(view, event.id), event.id).toEqual(reconstruct(trace, event.id))
    }
    expect(view.events.find(event => event.id === 'p-s2')?.payload.systemPromptSameAs).toBe('p-s1')
  })

  it('a session without snapshots leaves both slots unavailable', async () => {
    const trace = await claudeLoad('plain/session.jsonl')
    expect(trace.capabilities).not.toContain('systemPrompt')
    expect(trace.capabilities).not.toContain('toolSchemas')
    expect(trace.session.systemPrompt).toBeUndefined()
    expect(promptSlots(trace, 'request:req-1')).toEqual([
      ['system', 'unavailable', undefined],
      ['tools', 'unavailable', undefined],
    ])
  })

  it('Codex base_instructions becomes the system prompt, listed only when recorded', async () => {
    const plain = await loadSession({ path: fixture('codex', 'rollout-plain.jsonl') }, { platform })
    expect(plain.session.systemPrompt).toBe('Be brief.')
    expect(plain.capabilities).toContain('systemPrompt')
    const request = plain.events.find(event => event.kind === 'request')!
    expect(
      reconstruct(plain, request.id)
        .slots?.slice(0, 2)
        .map(slot => slot.status),
    ).toEqual(['present', 'unavailable'])

    const bare = await loadSession({ path: fixture('codex', 'rollout-token-count.jsonl') }, { platform })
    expect(bare.session.systemPrompt).toBeUndefined()
    expect(bare.capabilities).not.toContain('systemPrompt')
    const first = bare.events.find(event => event.kind === 'request')!
    expect(
      reconstruct(bare, first.id)
        .slots?.slice(0, 2)
        .map(slot => slot.status),
    ).toEqual(['unavailable', 'unavailable'])
  })
})
