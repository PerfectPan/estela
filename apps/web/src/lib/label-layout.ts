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
  if (x + OFFSET + width <= right)
    return { x: x + OFFSET, width, flipped: false }
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
export function layoutLabels(rules: readonly { x: number, width: number }[], right: number): LabelSlot[] {
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
    if (lastBoxed >= 0)
      slots[lastBoxed]!.more += 1
  })
  return slots
}
