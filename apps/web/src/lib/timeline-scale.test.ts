import { describe, expect, it } from 'vite-plus/test'
import {
  axisTicks,
  barHolding,
  bucketBars,
  edgeTo,
  isFullRange,
  makeScale,
  niceStep,
  normalizeRange,
  stepEdge,
  tokenGrid,
  tsOf,
  xOf,
} from './timeline-scale.ts'

const MINUTE = 60_000
const scale = makeScale(0, 72 * MINUTE, 148, 1404)

describe('time scale', () => {
  it('maps time to x and back', () => {
    expect(xOf(scale, 0)).toBe(148)
    expect(xOf(scale, 72 * MINUTE)).toBe(1404)
    expect(xOf(scale, 36 * MINUTE)).toBe(776)
    expect(tsOf(scale, 776)).toBe(36 * MINUTE)
    // Clamped to the plot.
    expect(tsOf(scale, 0)).toBe(0)
    expect(tsOf(scale, 5000)).toBe(72 * MINUTE)
  })

  it('gives a zero-length session a 1 s axis', () => {
    const flat = makeScale(5, 5, 0, 100)
    expect(flat.end).toBe(1005)
    expect(xOf(flat, 5)).toBe(0)
  })

  it('picks round axis steps', () => {
    expect(niceStep(72 * MINUTE, 12)).toBe(6 * MINUTE)
    expect(niceStep(40_000, 12)).toBe(5_000)
    expect(axisTicks(scale, 12)).toHaveLength(13)
    expect(axisTicks(scale, 12).at(-1)).toBe(72 * MINUTE)
  })

  it('draws at most two round token grid lines', () => {
    expect(tokenGrid(118_400)).toEqual([50_000, 100_000])
    expect(tokenGrid(250_000)).toEqual([100_000, 200_000])
    expect(tokenGrid(45_000)).toEqual([20_000, 40_000])
    expect(tokenGrid(0)).toEqual([])
  })
})

describe('brush range', () => {
  it('sorts and clamps a dragged range', () => {
    expect(normalizeRange(50, 10, 0, 40)).toEqual({ from: 10, to: 40 })
    expect(normalizeRange(-5, 3, 0, 40)).toEqual({ from: 0, to: 3 })
  })

  it('treats the whole session as no range', () => {
    expect(isFullRange(undefined, scale)).toBe(true)
    expect(isFullRange({ from: 0, to: 72 * MINUTE }, scale)).toBe(true)
    expect(isFullRange({ from: MINUTE, to: 72 * MINUTE }, scale)).toBe(false)
  })

  it('steps a handle by 1 %, or 10 % with Shift, without crossing the other', () => {
    const range = { from: 30 * MINUTE, to: 46 * MINUTE }
    const small = 72 * MINUTE * 0.01
    expect(stepEdge(range, 'from', 1, false, scale)).toEqual({ from: 30 * MINUTE + small, to: 46 * MINUTE })
    expect(stepEdge(range, 'to', -1, true, scale).to).toBeCloseTo(46 * MINUTE - 7.2 * MINUTE)
    expect(stepEdge({ from: 45 * MINUTE, to: 46 * MINUTE }, 'from', 1, true, scale)).toEqual({
      from: 46 * MINUTE,
      to: 46 * MINUTE,
    })
    expect(stepEdge({ from: 0, to: 46 * MINUTE }, 'from', -1, false, scale).from).toBe(0)
    expect(stepEdge({ from: 0, to: 72 * MINUTE }, 'to', 1, true, scale).to).toBe(72 * MINUTE)
  })

  it('moves a handle to either end with Home and End', () => {
    const range = { from: 30 * MINUTE, to: 46 * MINUTE }
    expect(edgeTo(range, 'from', 'start', scale)).toEqual({ from: 0, to: 46 * MINUTE })
    expect(edgeTo(range, 'from', 'end', scale)).toEqual({ from: 46 * MINUTE, to: 46 * MINUTE })
    expect(edgeTo(range, 'to', 'end', scale)).toEqual({ from: 30 * MINUTE, to: 72 * MINUTE })
  })
})

describe('bars', () => {
  it('keeps one bar per request when they are far apart', () => {
    const bars = bucketBars(
      [
        { ts: 0, tokens: 5, id: 'a' },
        { ts: 36 * MINUTE, id: 'b' },
      ],
      scale,
      3,
    )
    expect(bars).toEqual([
      { x: 148, tokens: 5, id: 'a', count: 1 },
      { x: 776, id: 'b', count: 1 },
    ])
  })

  it('merges requests closer than the gap and keeps the largest recorded value', () => {
    const bars = bucketBars(
      [
        { ts: 0, id: 'a' },
        { ts: 1000, tokens: 7, id: 'b' },
        { ts: 2000, tokens: 3, id: 'c' },
      ],
      scale,
      3,
    )
    expect(bars).toEqual([{ x: 148, tokens: 7, id: 'b', count: 3 }])
  })
})

describe('barHolding', () => {
  const inputs = [
    { ts: 0, id: 'a' },
    { ts: 1000, tokens: 7, id: 'b' },
    { ts: 36 * MINUTE, id: 'c' },
  ]
  const bars = bucketBars(inputs, scale, 3)

  it('finds the bucket of a request that the bucket does not name', () => {
    expect(bars.map(bar => bar.id)).toEqual(['b', 'c'])
    expect(barHolding(bars, inputs, 'a', scale)).toBe(bars[0])
    expect(barHolding(bars, inputs, 'b', scale)).toBe(bars[0])
    expect(barHolding(bars, inputs, 'c', scale)).toBe(bars[1])
  })

  it('finds nothing for a request of another lane or no request', () => {
    expect(barHolding(bars, inputs, 'other', scale)).toBeUndefined()
    expect(barHolding(bars, inputs, undefined, scale)).toBeUndefined()
  })
})
