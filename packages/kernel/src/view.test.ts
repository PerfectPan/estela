import type { Trace } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { toView } from './view.ts'

describe('toView', () => {
  it('drops original and caps long strings', () => {
    const trace: Trace = {
      schema: 'agent-trace',
      host: { id: 'demo' },
      session: { id: 's' },
      capabilities: [],
      agents: [],
      skipped: [],
      events: [{
        id: 'e',
        seq: 0,
        ts: 0,
        kind: 'user',
        payload: { text: 'x'.repeat(20) },
        source: { file: 'fixture.json', offset: 0, length: 1, line: 1 },
        original: { secret: 'keep-me-out' },
      }],
    }
    const view = toView(trace, { maxString: 8 })
    expect(view.events[0]?.original).toBeUndefined()
    expect(view.events[0]?.payload.text).toBe('xxxxxxxx')
    expect(view.events[0]?.payload.$truncated).toEqual(['text'])
    expect(trace.events[0]?.original).toEqual({ secret: 'keep-me-out' })
  })
})
