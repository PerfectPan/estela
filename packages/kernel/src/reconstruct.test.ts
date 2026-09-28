import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Trace } from '@rivus/agent-trace-schema'
import { isTrace } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { reconstruct } from './reconstruct.ts'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/demo.trace.json')

describe('reconstruct', () => {
  it('drops shadowed events after compaction, keeps them in the archive', async () => {
    const trace = JSON.parse(await readFile(fixturePath, 'utf8')) as unknown
    expect(isTrace(trace)).toBe(true)
    if (!isTrace(trace))
      return

    const before = reconstruct(trace, 'e3')
    expect(before.visibleIds).toContain('e3')
    expect(before.completeness).toBe('partial')

    const after = reconstruct(trace, 'e6')
    expect(after.visibleIds).not.toContain('e3')
    expect(after.visibleIds).not.toContain('e4')
    expect(after.visibleIds).toContain('e5')
    expect(trace.events.map(e => e.id)).toContain('e3')

    const request = reconstruct(trace, 'e7')
    expect(request.inputTokens).toBe(30)
    expect(request.postTokens).toBe(100)
  })

  it('reports system unavailable unless the host declares and recorded a system prompt', () => {
    const base = {
      schema: 'agent-trace' as const,
      host: { id: 'test' },
      session: { id: 's' },
      capabilities: [] as Trace['capabilities'],
      agents: [],
      events: [{ id: 's1', seq: 0, ts: 1, kind: 'system' as const, payload: { text: 'hint' }, source: { file: 'f', offset: 0, length: 1, line: 1 } }],
      skipped: [],
    }
    expect(reconstruct(base, 's1').unavailable).toContain('system')
    expect(reconstruct({ ...base, session: { id: 's', systemPrompt: 'p' } }, 's1').unavailable).toContain('system')
    expect(reconstruct({ ...base, capabilities: ['systemPrompt'], session: { id: 's', systemPrompt: 'p' } }, 's1').unavailable)
      .not.toContain('system')
  })

  it('does not invent a missing event', () => {
    const result = reconstruct({
      schema: 'agent-trace',
      host: { id: 'test' },
      session: { id: 's' },
      capabilities: [],
      agents: [],
      events: [],
      skipped: [],
    }, 'missing')
    expect(result.completeness).toBe('unavailable')
    expect(result.unavailable).toContain('event')
  })
})
