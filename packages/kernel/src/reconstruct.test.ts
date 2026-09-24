import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  })

  it('does not invent a missing event', () => {
    const result = reconstruct({
      schema: 'agent-trace/v0',
      host: 'test',
      session: { id: 's' },
      events: [],
    }, 'missing')
    expect(result.completeness).toBe('unavailable')
    expect(result.unavailable).toContain('event')
  })
})
