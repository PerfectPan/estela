import type { AgentInfo, SkippedRecord, Trace, TraceEvent, TruncatedPath } from '@rivus/agent-trace-schema'
import { isObjectLike } from 'lodash-es'

const DEFAULT_MAX = 4096
/** Plan 1.3: at most 12 MB reaches the browser before an event is selected. */
export const VIEW_BUDGET_BYTES = 12 * 1000 * 1000
const MIN_STRING = 256
const STEP = 0.75

/** `value` cut to at most `max` UTF-16 units, never between the two halves of a surrogate pair. */
function cut(value: string, max: number): string {
  const high = value.charCodeAt(max - 1)
  const end = high >= 0xD800 && high <= 0xDBFF ? max - 1 : max
  return value.slice(0, end)
}

class Capper {
  readonly truncated: TruncatedPath[] = []
  readonly max: number
  constructor(max: number) {
    this.max = max
  }

  text(value: string, path: TruncatedPath): string {
    if (value.length <= this.max)
      return value
    this.truncated.push(path)
    return cut(value, this.max)
  }

  value(value: unknown, path: TruncatedPath): unknown {
    if (typeof value === 'string')
      return this.text(value, path)
    if (Array.isArray(value))
      return value.map((item, index) => this.value(item, [...path, index]))
    if (isObjectLike(value)) {
      const record = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(record)) {
        // A long key is cut too; its path names the key as it appears in the view.
        // Two long keys with the same prefix would collide, so a later one gets `#2`, `#3`, ….
        let shown = key.length > this.max ? cut(key, this.max) : key
        if (shown !== key) {
          const base = shown
          for (let suffix = 2; Object.hasOwn(out, shown) || Object.hasOwn(record, shown); suffix++)
            shown = `${base}#${suffix}`
          this.truncated.push([...path, shown])
        }
        out[shown] = this.value(item, [...path, shown])
      }
      return out
    }
    return value
  }
}

function capEvent(event: TraceEvent, max: number, fileIndex: (file: string) => string): TraceEvent {
  const capper = new Capper(max)
  const { $truncated: _previous, ...rest } = event.payload
  const payload = capper.value(rest, []) as Record<string, unknown>
  if (capper.truncated.length > 0)
    payload.$truncated = capper.truncated
  const { original: _original, ...fields } = event
  return { ...fields, payload, source: { ...event.source, file: fileIndex(event.source.file) } }
}

/** One entry per file and reason, with the first line and a count. */
function groupSkipped(skipped: readonly SkippedRecord[], max: number): SkippedRecord[] {
  const groups = new Map<string, SkippedRecord>()
  for (const entry of skipped) {
    const key = `${entry.file}\0${entry.reason}`
    const group = groups.get(key)
    if (group)
      group.count = (group.count ?? 1) + (entry.count ?? 1)
    else
      groups.set(key, { file: entry.file, line: entry.line, reason: cut(entry.reason, max), count: entry.count ?? 1 })
  }
  return [...groups.values()]
}

function capAgent(agent: AgentInfo, max: number): AgentInfo {
  const out = { ...agent }
  if (out.title !== undefined && out.title.length > max)
    out.title = cut(out.title, max)
  if (out.systemPrompt !== undefined && out.systemPrompt.length > max)
    out.systemPrompt = cut(out.systemPrompt, max)
  return out
}

/**
 * The trace the browser receives (D6, plan 3.3). Pure: the input is not changed.
 *
 * - Drops `original`; `get-event` reads it back from the source pointer.
 * - Caps every string and object key at `maxString` UTF-16 units (default
 *   4,096), never splitting a surrogate pair, and lists the shortened paths in
 *   `payload.$truncated` (and `session.$truncated`) as key/index arrays.
 *   `agents[].title` and `skipped[].reason` are capped too.
 * - Interns source files: `sourceFiles` lists them once and each event's
 *   `source.file` is its index, so `file` + `line` still names one record.
 * - Merges `skipped` entries per file and reason, with a count.
 * - Records the cap in `view.maxString`, so the UI can say how text was shortened.
 */
export function toView(trace: Trace, opts?: { maxString?: number }): Trace {
  const max = opts?.maxString ?? DEFAULT_MAX
  const capper = new Capper(max)
  const { $truncated: _previous, ...rest } = trace.session
  const session = capper.value(rest, []) as Trace['session']
  if (capper.truncated.length > 0)
    session.$truncated = capper.truncated
  const files = new Map<string, string>()
  const fileIndex = (file: string): string => {
    let index = files.get(file)
    if (index === undefined) {
      index = String(files.size)
      files.set(file, index)
    }
    return index
  }
  const { view: _view, ...base } = trace
  return {
    ...base,
    session,
    agents: trace.agents.map(agent => capAgent(agent, max)),
    events: trace.events.map(event => capEvent(event, max, fileIndex)),
    skipped: groupSkipped(trace.skipped, max),
    sourceFiles: [...files.keys()],
    view: { maxString: max },
  }
}

export interface FittedView {
  /** The view; `trace.view` holds the cap, the budget, and `withinBudget`. */
  trace: Trace
  /** UTF-8 size of the serialized view. */
  bytes: number
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * `toView` within a byte budget. Sessions whose view fits keep the 4,096 cap;
 * larger ones get a lower cap, in steps of 0.75, down to 256 characters. At the
 * floor the view is returned anyway with `view.withinBudget: false`.
 */
export function fitView(trace: Trace, opts?: { maxString?: number, maxBytes?: number }): FittedView {
  const budget = opts?.maxBytes ?? VIEW_BUDGET_BYTES
  let max = opts?.maxString ?? DEFAULT_MAX
  while (true) {
    const view = toView(trace, { maxString: max })
    view.view = { maxString: max, budgetBytes: budget, withinBudget: true }
    const bytes = jsonBytes(view)
    if (bytes <= budget)
      return { trace: view, bytes }
    if (max <= MIN_STRING) {
      view.view.withinBudget = false
      // `false` is one byte longer than `true`.
      return { trace: view, bytes: bytes + 1 }
    }
    max = Math.max(MIN_STRING, Math.floor(max * STEP))
  }
}
