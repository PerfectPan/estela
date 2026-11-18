import { describe, expect, it } from 'vite-plus/test'
import { compactTokens, sessionShape } from './session-shape.ts'

describe('sessionShape', () => {
  const shape = sessionShape()

  it('is deterministic, so the prerendered fallback and the WebGL scene draw the same session', () => {
    expect(sessionShape()).toEqual(shape)
  })

  it('grows the context until the compaction, then cuts it to the stated size', () => {
    const before = shape.main.filter(bar => bar.step < shape.compaction.step)
    const after = shape.main.filter(bar => bar.step > shape.compaction.step)
    for (const run of [before, after]) {
      for (let i = 1; i < run.length; i++) {
        expect(run[i]!.tokens).toBeGreaterThan(run[i - 1]!.tokens)
      }
    }
    expect(before.at(-1)!.tokens).toBe(shape.compaction.before)
    expect(after[0]!.tokens).toBe(shape.compaction.after)
    expect(shape.compaction.after).toBeLessThan(shape.compaction.before / 2)
  })

  it('marks only the requests before the compaction as hidden from the model', () => {
    expect(shape.main.every(bar => bar.shadowed === bar.step < shape.compaction.step)).toBe(true)
  })

  it('starts each subagent lane after its spawn and selects a request after the compaction', () => {
    for (const lane of shape.lanes) {
      expect(lane.bars[0]!.step).toBeGreaterThan(lane.spawnStep)
    }
    expect(shape.selected).toBeGreaterThan(shape.compaction.step)
    expect(shape.main.some(bar => bar.step === shape.selected)).toBe(true)
  })
})

describe('compactTokens', () => {
  it('rounds to thousands', () => {
    expect(compactTokens(168_412)).toBe('168k')
    expect(compactTokens(41_500)).toBe('42k')
  })
})
