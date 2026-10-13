import { describe, expect, it } from 'vite-plus/test'
import { LABEL_ROW, layoutLabels, placeLabel, rovingIndex, ruleTarget } from './label-layout.ts'

describe('compaction label layout', () => {
  it('puts a box right of its rule, or left of it at the right edge', () => {
    expect(placeLabel(100, 50, 1000)).toEqual({ x: 106, width: 50, flipped: false })
    expect(placeLabel(980, 50, 1000)).toEqual({ x: 924, width: 50, flipped: true })
  })

  it('boxes rules that fit and folds the others into the box before them', () => {
    const slots = layoutLabels(
      [
        { x: 100, width: 80 },
        { x: 150, width: 80 },
        { x: 170, width: 80 },
        { x: 400, width: 80 },
      ],
      1000,
    )
    expect(slots.map(slot => slot.box?.x)).toEqual([106, undefined, undefined, 406])
    expect(slots.map(slot => slot.more)).toEqual([2, 0, 0, 0])
    expect(slots[1]!.clusterOf).toBe(0)
  })

  it('never lets a box flipped at the right edge cross the previous box or its rule', () => {
    // The last rule is near the edge: its flipped box would cover the box at 850.
    const slots = layoutLabels(
      [
        { x: 850, width: 100 },
        { x: 990, width: 100 },
      ],
      1000,
    )
    expect(slots[0]!.box).toEqual({ x: 856, width: 100, flipped: false })
    expect(slots[1]!.box).toBeUndefined()
    expect(slots[0]!.more).toBe(1)
    // Far enough apart, the flipped box fits between them.
    const apart = layoutLabels(
      [
        { x: 600, width: 100 },
        { x: 990, width: 100 },
      ],
      1000,
    )
    expect(apart[1]!.box).toEqual({ x: 884, width: 100, flipped: true })
    const boxes = apart.map(slot => slot.box!)
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x)
  })

  it('checks overlap on the left side too', () => {
    // A flipped box whose left edge would pass over the previous rule is not drawn.
    const slots = layoutLabels(
      [
        { x: 880, width: 10 },
        { x: 990, width: 150 },
      ],
      1000,
    )
    expect(slots[1]!.box).toBeUndefined()
  })

  it('keeps each rule target inside the label row, off the plot area below', () => {
    const target = ruleTarget(500)
    expect(target).toEqual({ x: 496, y: 4, width: 8, height: 18 })
    // The main lane's bars start at y 22 and the drag surface covers the plot below the row.
    expect(target.y + target.height).toBeLessThanOrEqual(LABEL_ROW.y + LABEL_ROW.height)
    expect(target.y + target.height).toBeLessThanOrEqual(22)
  })

  it('moves the one tab stop with arrows, Home, and End', () => {
    expect(rovingIndex(0, 'ArrowRight', 3)).toBe(1)
    expect(rovingIndex(2, 'ArrowRight', 3)).toBe(2)
    expect(rovingIndex(0, 'ArrowLeft', 3)).toBe(0)
    expect(rovingIndex(1, 'End', 3)).toBe(2)
    expect(rovingIndex(2, 'Home', 3)).toBe(0)
    expect(rovingIndex(1, 'Tab', 3)).toBeUndefined()
    expect(rovingIndex(0, 'ArrowRight', 0)).toBeUndefined()
  })
})
