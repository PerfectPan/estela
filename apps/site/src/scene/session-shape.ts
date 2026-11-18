/**
 * The illustrative session drawn in the hero, by both the WebGL scene and the SVG fallback. It follows the
 * product's encoding (docs/design/README.md): one bar per request whose height is its input tokens, a compaction
 * that cuts the context, and one lane per subagent. The numbers are sample data, not a recorded session.
 */
interface RequestBar {
  /** Position on the session's time axis, 0 at the first request. */
  step: number
  /** Input tokens of the request. */
  tokens: number
  /** Hidden from the model by the compaction (the product dims these). */
  shadowed: boolean
}

interface SubagentLane {
  /** Main-lane step that spawned the subagent. */
  spawnStep: number
  bars: RequestBar[]
}

export interface SessionShape {
  main: RequestBar[]
  lanes: SubagentLane[]
  compaction: { step: number; before: number; after: number }
  /** Steps where the user typed a prompt (a new turn). */
  prompts: number[]
  /** The request whose context the hero calls out ("Model saw"). */
  selected: number
  maxTokens: number
}

const MAIN_REQUESTS = 36
const COMPACTION_AFTER = 22
const CONTEXT_AFTER_COMPACTION = 41_800

/** Small deterministic PRNG so server render, fallback, and WebGL draw the same bars. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function growth(random: () => number, start: number, count: number, from: number, step: number): RequestBar[] {
  const bars: RequestBar[] = []
  let tokens = from
  for (let i = 0; i < count; i++) {
    bars.push({ step: start + i, tokens: Math.round(tokens), shadowed: false })
    // A tool result or a long reply now and then makes the context jump.
    const jump = random() < 0.18 ? step * (2 + random() * 2) : 0
    tokens += step * (0.45 + random()) + jump
  }
  return bars
}

export function sessionShape(): SessionShape {
  const random = mulberry32(0x5e55)
  const before = growth(random, 0, COMPACTION_AFTER, 16_400, 6_300)
  const after = growth(random, COMPACTION_AFTER, MAIN_REQUESTS - COMPACTION_AFTER, CONTEXT_AFTER_COMPACTION, 5_200)
  // The compaction hides everything before it from later requests.
  const main = [...before.map(bar => ({ ...bar, shadowed: true })), ...after]
  const lanes: SubagentLane[] = [
    { spawnStep: 7, bars: growth(random, 7.5, 8, 9_200, 3_900) },
    { spawnStep: 27, bars: growth(random, 27.5, 6, 7_600, 4_400) },
  ]
  const peak = before.at(-1)!.tokens
  return {
    main,
    lanes,
    compaction: { step: COMPACTION_AFTER - 0.5, before: peak, after: CONTEXT_AFTER_COMPACTION },
    prompts: [0, 6, 13, 19, 25, 31],
    selected: MAIN_REQUESTS - 1,
    maxTokens: Math.max(...main.map(bar => bar.tokens), ...lanes.flatMap(lane => lane.bars.map(bar => bar.tokens))),
  }
}

/** `168,400` → `168k`: the compact form the product uses on bars and rules. */
export function compactTokens(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}
