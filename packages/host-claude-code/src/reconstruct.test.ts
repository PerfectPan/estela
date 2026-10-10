import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectLanes, reconstruct } from '@rivus/agent-trace-kernel'
import { nodeIO } from '@rivus/agent-trace-runtime-node/io'
import { describe, expect, it } from 'vitest'
import { claudeCodeAdapter } from './index.ts'

const path = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/sessions/claude-code/conformance/compaction/session.jsonl')

describe('claude-code reconstruct (S7)', () => {
  it('shows slots, recorded counts, and removed events at the first request after a compaction', async () => {
    const trace = await claudeCodeAdapter.load({ host: 'claude-code', path }, nodeIO, {})
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

  it('has no compaction count before the compaction', async () => {
    const trace = await claudeCodeAdapter.load({ host: 'claude-code', path }, nodeIO, {})
    const firstRequest = trace.events.find(event => event.kind === 'request')!
    const result = reconstruct(trace, firstRequest.id)
    expect(result.removedIds).toEqual([])
    expect(result.tokens).toEqual([
      { slots: ['system', 'tools', 'summary', 'messages', 'currentTurn'], tokens: 100, from: 'request.inputTokens' },
    ])
  })
})
