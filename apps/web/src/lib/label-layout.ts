/** Gap between a rule and its label box, and between neighbouring boxes. */
const OFFSET = 6
const GAP = 4

export interface LabelBox {
  /** Left edge of the box. */
  x: number
  width: number
  /** The box sits left of its rule (it would cross the right edge otherwise). */
  flipped: boolean
}

/** Where one label box goes: right of its rule, or left of it when it would pass `right`. */
export function placeLabel(x: number, width: number, right: number): LabelBox {
  if (x + OFFSET + width <= right) {
    return { x: x + OFFSET, width, flipped: false }
  }
  return { x: Math.max(0, x - OFFSET - width), width, flipped: true }
}

export interface LabelSlot {
  box?: LabelBox
  /** Rules without a box of their own that belong to this box (drawn as `+N`). */
  more: number
  /** Index of the boxed label this rule's number is folded into, for an unboxed rule. */
  clusterOf?: number
}

/**
 * Boxes for rules sorted by x (compaction labels, S5). A box never overlaps the previous box,
 * including a box flipped to the left at the right edge; a rule whose box would overlap is
 * left unboxed and counted on the box before it. Every rule keeps its own hover/focus label.
 */
export function layoutLabels(rules: readonly { x: number; width: number }[], right: number): LabelSlot[] {
  const slots: LabelSlot[] = []
  let lastRight = Number.NEGATIVE_INFINITY
  let lastBoxed = -1
  rules.forEach((rule, index) => {
    const box = placeLabel(rule.x, rule.width, right)
    // A flipped box must also not cover the previous box's rule.
    const clear = box.x >= lastRight + GAP && (!box.flipped || lastBoxed < 0 || box.x > rules[lastBoxed]!.x)
    if (clear) {
      slots.push({ box, more: 0 })
      lastRight = box.x + box.width
      lastBoxed = index
      return
    }
    slots.push({ more: 0, ...(lastBoxed >= 0 ? { clusterOf: lastBoxed } : {}) })
    if (lastBoxed >= 0) {
      slots[lastBoxed]!.more += 1
    }
  })
  return slots
}

/** Top and height of the label row above the plot (the boxes sit at y 4–22). */
export const LABEL_ROW = { y: 4, height: 18 } as const

/**
 * The hover and focus target of one rule: 8 px wide and only as tall as the label row, so a
 * drag or click on the plot next to a rule still reaches the brush.
 */
export function ruleTarget(x: number): { x: number; y: number; width: number; height: number } {
  return { x: x - 4, y: LABEL_ROW.y, width: 8, height: LABEL_ROW.height }
}

/** Roving focus over the rules: arrows move by one, Home / End jump; other keys give `undefined`. */
export function rovingIndex(current: number, key: string, count: number): number | undefined {
  if (count === 0) {
    return undefined
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return Math.min(count - 1, current + 1)
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return Math.max(0, current - 1)
  }
  if (key === 'Home') {
    return 0
  }
  if (key === 'End') {
    return count - 1
  }
  return undefined
}
