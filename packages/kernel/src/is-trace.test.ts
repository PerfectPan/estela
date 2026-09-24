import { isTrace } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'

const source = { file: 'f', offset: 0, length: 1, line: 1 }

function trace(partial: Record<string, unknown> = {}) {
  return {
    schema: 'agent-trace',
    host: { id: 'demo' },
    session: { id: 's' },
    capabilities: [],
    agents: [],
    events: [],
    skipped: [],
    ...partial,
  }
}

describe('isTrace', () => {
  it('accepts an empty canonical trace', () => {
    expect(isTrace(trace())).toBe(true)
  })

  it('rejects a bad kind, a non-string capability, and a malformed agent or skip', () => {
    expect(isTrace(trace({
      events: [{ id: 'e', seq: 0, ts: 1, kind: 'nope', payload: {}, source }],
    }))).toBe(false)
    expect(isTrace(trace({ capabilities: [1] }))).toBe(false)
    expect(isTrace(trace({ agents: [{ parentId: 'main' }] }))).toBe(false)
    expect(isTrace(trace({ agents: [{ id: 1 }] }))).toBe(false)
    expect(isTrace(trace({ skipped: [{ line: 1 }] }))).toBe(false)
    expect(isTrace(trace({ skipped: [{ line: '1', file: 'f', reason: 'x' }] }))).toBe(false)
  })
})
