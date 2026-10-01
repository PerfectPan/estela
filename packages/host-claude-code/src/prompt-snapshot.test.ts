import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstruct, toView } from '@rivus/agent-trace-kernel'
import { nodeIO } from '@rivus/agent-trace-runtime-node/io'
import { describe, expect, it } from 'vitest'
import { claudeCodeAdapter } from './index.ts'
import { parseClaudeRecords } from './parse-session.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/conformance')
const load = (name: string) => claudeCodeAdapter.load({ host: 'claude-code', path: join(root, name, 'session.jsonl') }, nodeIO, {})

function promptSlots(trace: Awaited<ReturnType<typeof load>>, eventId: string) {
  const slots = reconstruct(trace, eventId).slots ?? []
  return slots.filter(slot => slot.name === 'system' || slot.name === 'tools')
    .map(slot => [slot.name, slot.status, slot.recordedBy])
}

describe('claude-code prompt snapshots', () => {
  it('keeps each snapshot as a system event with its source and original', async () => {
    const trace = await load('prompt-snapshot')
    const snapshots = trace.events.filter(event => event.kind === 'system' && event.payload.type === 'prompt_snapshot')
    expect(snapshots.map(event => [event.id, event.agentId])).toEqual([
      ['p-s1', undefined],
      ['p-s2', undefined],
      ['w-s1', 'worker'],
      ['p-s3', undefined],
    ])
    expect(snapshots[0]!.payload).toEqual({ type: 'prompt_snapshot', systemPrompt: 'You are a test agent.\n\nPrompt version one.' })
    expect(snapshots[1]!.payload).toMatchObject({ cliPrefix: 'Test CLI prefix.', tools: [{ name: 'Read' }] })
    expect(snapshots[3]!.payload.tools).toHaveLength(2)
    for (const event of snapshots)
      expect((event.original as { attachment: { type: string } }).attachment.type).toBe('prompt_snapshot')
    expect(trace.skipped.some(skip => skip.reason === 'attachment:prompt_snapshot')).toBe(false)
  })

  it('sets the session and lane fields from the latest snapshot and lists the capabilities', async () => {
    const trace = await load('prompt-snapshot')
    expect(trace.session.systemPrompt).toBe('You are a test agent.\n\nPrompt version two.')
    expect(trace.session.tools).toHaveLength(2)
    expect(trace.agents.find(agent => agent.id === 'worker')).toEqual({
      id: 'worker',
      parentId: 'main',
      spawnEventId: 'p-a2:1',
      title: 'Check a file',
      systemPrompt: 'You are a test worker.',
    })
    expect(trace.capabilities).toContain('systemPrompt')
    expect(trace.capabilities).toContain('toolSchemas')
  })

  it('uses the latest snapshot at or before each request on its lane', async () => {
    const trace = await load('prompt-snapshot')
    // Only the systemPrompt-only snapshot precedes the first request: tools are not recorded yet.
    expect(promptSlots(trace, 'request:req-p1')).toEqual([['system', 'present', 'p-s1'], ['tools', 'unavailable', undefined]])
    expect(promptSlots(trace, 'request:req-p2')).toEqual([['system', 'present', 'p-s2'], ['tools', 'present', 'p-s2']])
    // The prompt changed mid-session.
    expect(promptSlots(trace, 'request:req-p4')).toEqual([['system', 'present', 'p-s3'], ['tools', 'present', 'p-s3']])
    // The subagent lane has its own systemPrompt-only snapshot and never sees the main lane's.
    expect(promptSlots(trace, 'request:req-w1')).toEqual([['system', 'present', 'w-s1'], ['tools', 'unavailable', undefined]])
    expect(reconstruct(trace, 'request:req-p4').tokens).toEqual([
      { slots: ['system', 'tools', 'summary', 'messages', 'currentTurn'], tokens: 30, from: 'request.inputTokens' },
    ])
  })

  it('reconstructs the same result from the view trace, which keeps each repeated prompt once', async () => {
    const trace = await load('prompt-snapshot')
    const view = toView(trace, { maxString: 16 })
    for (const event of trace.events)
      expect(reconstruct(view, event.id), event.id).toEqual(reconstruct(trace, event.id))
    expect(view.events.find(event => event.id === 'p-s2')?.payload.systemPromptSameAs).toBe('p-s1')
  })

  it('leaves both slots unavailable for a session without snapshots', async () => {
    const trace = await load('plain')
    expect(trace.capabilities).not.toContain('systemPrompt')
    expect(trace.capabilities).not.toContain('toolSchemas')
    expect(trace.session.systemPrompt).toBeUndefined()
    expect(promptSlots(trace, 'request:req-1')).toEqual([['system', 'unavailable', undefined], ['tools', 'unavailable', undefined]])
  })

  it('rejects a snapshot whose system prompt is not text', () => {
    const value = { type: 'attachment', uuid: 'x', timestamp: '2026-01-01T00:00:00.000Z', version: '2.1.268', attachment: { type: 'prompt_snapshot', systemPrompt: [{ text: 'x' }] } }
    expect(() => parseClaudeRecords([{ record: { value, file: 'f.jsonl', line: 1, offset: 0, length: 1 }, ts: 1 }]))
      .toThrow('claude-code: f.jsonl:1: unknown format generation')
  })
})
