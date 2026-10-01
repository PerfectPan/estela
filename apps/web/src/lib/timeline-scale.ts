/**
 * Pure math for the timeline: time ↔ x, axis ticks, the brush range and its
 * keyboard steps, and request bucketing. No DOM, so it is unit-tested.
 */

export interface TimeScale {
  /** Session start and end, epoch ms. `end > start` (see `makeScale`). */
  start: number
  end: number
  /** Plot area in px. */
  x0: number
  x1: number
}

/** A time range in epoch ms, `from <= to`. */
export interface TimeRange {
  from: number
  to: number
}

/** A zero-length session still gets a 1 s wide axis, so nothing divides by zero. */
export function makeScale(start: number, end: number, x0: number, x1: number): TimeScale {
  return { start, end: end > start ? end : start + 1000, x0, x1: x1 > x0 ? x1 : x0 + 1 }
}

export function xOf(scale: TimeScale, ts: number): number {
  return scale.x0 + ((ts - scale.start) / (scale.end - scale.start)) * (scale.x1 - scale.x0)
}

export function tsOf(scale: TimeScale, x: number): number {
  const clamped = Math.min(scale.x1, Math.max(scale.x0, x))
  return scale.start + ((clamped - scale.x0) / (scale.x1 - scale.x0)) * (scale.end - scale.start)
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const STEPS = [
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  3 * MINUTE,
  5 * MINUTE,
  6 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
]

/** The smallest round step that gives at most `maxTicks` intervals. */
export function niceStep(durationMs: number, maxTicks: number): number {
  for (const step of STEPS) {
    if (durationMs / step <= maxTicks) {
      return step
    }
  }
  const days = Math.ceil(durationMs / (24 * HOUR) / maxTicks)
  return days * 24 * HOUR
}

/** Elapsed times (ms from start) of the axis ticks, from 0 to the end. */
export function axisTicks(scale: TimeScale, maxTicks: number): number[] {
  const duration = scale.end - scale.start
  const step = niceStep(duration, maxTicks)
  const out: number[] = []
  for (let at = 0; at <= duration + 1e-6; at += step) {
    out.push(at)
  }
  return out
}

/** Round "nice" token values for the main lane grid: at most `max` lines below `top`. */
export function tokenGrid(top: number, max = 2): number[] {
  if (!(top > 0)) {
    return []
  }
  const power = 10 ** Math.floor(Math.log10(top / max))
  const candidates = [1, 2, 5, 10, 20, 50].map(m => m * power)
  const step = candidates.find(candidate => Math.floor(top / candidate) <= max) ?? candidates.at(-1)!
  const out: number[] = []
  for (let value = step; value <= top; value += step) {
    out.push(value)
  }
  return out
}

/** Sorted and clamped to the session. */
export function normalizeRange(a: number, b: number, start: number, end: number): TimeRange {
  const lo = Math.max(start, Math.min(a, b))
  const hi = Math.min(end, Math.max(a, b))
  return { from: lo, to: Math.max(lo, hi) }
}

export function isFullRange(range: TimeRange | undefined, scale: TimeScale): boolean {
  return range === undefined || (range.from <= scale.start && range.to >= scale.end)
}

/** Arrow keys move one edge by 1 % of the session, Shift by 10 %. Edges never cross. */
export function stepEdge(
  range: TimeRange,
  edge: 'from' | 'to',
  direction: -1 | 1,
  big: boolean,
  scale: TimeScale,
): TimeRange {
  const duration = scale.end - scale.start
  const step = Math.max(1, duration * (big ? 0.1 : 0.01)) * direction
  if (edge === 'from') {
    const from = Math.min(range.to, Math.max(scale.start, range.from + step))
    return { from, to: range.to }
  }
  const to = Math.max(range.from, Math.min(scale.end, range.to + step))
  return { from: range.from, to }
}

/** Home / End: move one edge to the session's start or end. */
export function edgeTo(range: TimeRange, edge: 'from' | 'to', where: 'start' | 'end', scale: TimeScale): TimeRange {
  const target = where === 'start' ? scale.start : scale.end
  if (edge === 'from') {
    return { from: Math.min(range.to, target), to: range.to }
  }
  return { from: range.from, to: Math.max(range.from, target) }
}

export function inRange(ts: number, range: TimeRange | undefined): boolean {
  return range === undefined || (ts >= range.from && ts <= range.to)
}

export interface BarInput {
  ts: number
  /** `undefined`: the host did not record usage; drawn hollow. */
  tokens?: number
  id: string
}

export interface Bar {
  x: number
  /** Largest recorded value in the bucket; `undefined` when none in it was recorded. */
  tokens?: number
  /** The request drawn for this bucket (the largest one). */
  id: string
  count: number
}

/**
 * One bar per request, or, when requests are closer than `minGap` px, one bar
 * per `minGap` column holding the largest recorded value. Keeps the SVG small
 * for sessions with thousands of requests.
 */
export function bucketBars(inputs: readonly BarInput[], scale: TimeScale, minGap: number): Bar[] {
  const out: Bar[] = []
  let column = Number.NEGATIVE_INFINITY
  for (const input of inputs) {
    const x = xOf(scale, input.ts)
    const last = out.at(-1)
    if (last && x - column < minGap) {
      last.count += 1
      if (input.tokens !== undefined && (last.tokens === undefined || input.tokens > last.tokens)) {
        last.tokens = input.tokens
        last.id = input.id
      }
      continue
    }
    column = x
    const bar: Bar = { x, id: input.id, count: 1 }
    if (input.tokens !== undefined) {
      bar.tokens = input.tokens
    }
    out.push(bar)
  }
  return out
}
