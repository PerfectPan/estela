import { describe, expect, it } from 'vite-plus/test'
import { event, sample } from '@/testsupport/ledger-trace.ts'
import { compareChoices, compareTarget } from './context-compare.ts'
import { buildLedgerModel } from './ledger-model.ts'

function withThirdRequest() {
  const trace = sample()
  trace.events.push(event({ id: 'r3', kind: 'request', payload: { usage: { inputTokens: 30 } } }))
  return buildLedgerModel(trace)
}

describe('compareChoices', () => {
  it('offers the other requests of the lane, the previous one, and the last one before the compaction', () => {
    const choices = compareChoices(withThirdRequest(), 'r3')
    expect(choices.options.map(option => option.id)).toEqual(['r1', 'r2'])
    expect(choices.previous).toBe('r2')
    expect(choices.beforeCompaction).toBe('r1')
  })

  it('has no compaction pick when no compaction precedes the request', () => {
    const choices = compareChoices(withThirdRequest(), 'r1')
    expect(choices.previous).toBeUndefined()
    expect(choices.beforeCompaction).toBeUndefined()
    expect(choices.options.map(option => option.id)).toEqual(['r2', 'r3'])
  })

  it('stays on the subagent lane and offers nothing for an event that is not a request', () => {
    const model = withThirdRequest()
    expect(compareChoices(model, 's1')).toEqual({ options: [], previous: undefined, beforeCompaction: undefined })
    expect(compareChoices(model, 'p1').options).toEqual([])
  })
})

describe('compareTarget', () => {
  it('keeps a pick on the lane and falls back to the previous request otherwise', () => {
    const choices = compareChoices(withThirdRequest(), 'r3')
    expect(compareTarget(choices, 'r1')).toBe('r1')
    expect(compareTarget(choices, 's1')).toBe('r2')
    expect(compareTarget(choices, undefined)).toBe('r2')
  })

  it("compares a lane's first request with the next one, and has no target without another request", () => {
    const model = withThirdRequest()
    expect(compareTarget(compareChoices(model, 'r1'), undefined)).toBe('r2')
    expect(compareTarget(compareChoices(model, 's1'), undefined)).toBeUndefined()
  })
})
