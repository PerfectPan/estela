import type { Lane } from '@rivus/agent-kit/transcript'
import type { SkippedRecord, Trace, TraceEvent, TruncatedPath, ViewInfo } from '@rivus/agent-trace-schema'
import { assertTrace } from '@rivus/agent-trace-schema'
import { isPlainObject } from 'es-toolkit/predicate'
import { promptSnapshot } from './prompt-snapshot.ts'

const DEFAULT_MAX = 4096
/** Plan 1.3: at most 12 MB reaches the browser before an event is selected. */
export const VIEW_BUDGET_BYTES = 12 * 1000 * 1000
/**
 * The lowest cap, whatever a caller asks for: `fitView` stops lowering here. Capping cuts keys and string values, and
 * the view schema needs its declared keys (such as `callId`) and enum values (such as `granularity: 'session'`)
 * whole; all of them are far shorter than this.
 */
const MIN_STRING = 256
const STEP = 0.75

function capFor(maxString: number | undefined): number {
  return Math.max(MIN_STRING, maxString ?? DEFAULT_MAX)
}

/** `value` cut to at most `max` UTF-16 units, never between the two halves of a surrogate pair. */
function cut(value: string, max: number): string {
  const high = value.charCodeAt(max - 1)
  const end = high >= 0xd800 && high <= 0xdbff ? max - 1 : max
  return value.slice(0, end)
}

class Capper {
  readonly truncated: TruncatedPath[] = []
  readonly max: number
  constructor(max: number) {
    this.max = max
  }

  text(value: string, path: TruncatedPath): string {
    if (value.length <= this.max) {
      return value
    }
    this.truncated.push(path)
    return cut(value, this.max)
  }

  /**
   * A walk over arbitrary JSON (payload values come from `JSON.parse` or object literals), so containers are told
   * apart with `Array.isArray` and es-toolkit's `isPlainObject`, and strings with a primitive `typeof`.
   */
  value(value: unknown, path: TruncatedPath): unknown {
    if (typeof value === 'string') {
      return this.text(value, path)
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.value(item, [...path, index]))
    }
    if (isPlainObject(value)) {
      return this.record(value, path)
    }
    return value
  }

  record(record: Record<string, unknown>, path: TruncatedPath): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) {
      // A long key is cut too; its path names the key as it appears in the view.
      // Two long keys with the same prefix would collide, so a later one gets `#2`, `#3`, ….
      let shown = key.length > this.max ? cut(key, this.max) : key
      if (shown !== key) {
        const base = shown
        for (let suffix = 2; Object.hasOwn(out, shown) || Object.hasOwn(record, shown); suffix++) {
          shown = `${base}#${suffix}`
        }
        this.truncated.push([...path, shown])
      }
      out[shown] = this.value(item, [...path, shown])
    }
    return out
  }
}

/** Snapshot fields a view replaces with a reference: `systemPrompt` → `systemPromptSameAs`, `tools` → `toolsSameAs`. */
type SnapshotRefs = Map<string, { systemPromptSameAs?: string; toolsSameAs?: string }>

/**
 * For each prompt snapshot whose system prompt or non-empty tool list already
 * appeared on an earlier snapshot of the trace (any lane: subagents often repeat
 * one prompt), the id of the first snapshot that holds that content. Compared
 * on the full values, before any cap.
 */
function repeatedSnapshots(events: readonly TraceEvent[]): SnapshotRefs {
  const refs: SnapshotRefs = new Map()
  const prompts = new Map<string, string>()
  const toolLists = new Map<string, string>()
  for (const event of events) {
    const snapshot = promptSnapshot(event)
    if (!snapshot) {
      continue
    }
    const ref: { systemPromptSameAs?: string; toolsSameAs?: string } = {}
    if (snapshot.systemPrompt !== undefined && snapshot.systemPrompt.length > 0) {
      const holder = prompts.get(snapshot.systemPrompt)
      if (holder) {
        ref.systemPromptSameAs = holder
      } else {
        prompts.set(snapshot.systemPrompt, event.id)
      }
    }
    if (snapshot.tools !== undefined && snapshot.tools.length > 0) {
      const value = JSON.stringify(snapshot.tools)
      const holder = toolLists.get(value)
      if (holder) {
        ref.toolsSameAs = holder
      } else {
        toolLists.set(value, event.id)
      }
    }
    if (ref.systemPromptSameAs || ref.toolsSameAs) {
      refs.set(event.id, ref)
    }
  }
  return refs
}

/** The event as the view holds it; `unknown` to the type system until the whole view is checked. */
function capEvent(event: TraceEvent, max: number, fileIndex: (file: string) => string, refs: SnapshotRefs): unknown {
  const capper = new Capper(max)
  const { $truncated: _previous, ...rest }: Record<string, unknown> = event.payload
  const ref = refs.get(event.id)
  if (ref?.systemPromptSameAs) {
    delete rest.systemPrompt
    capper.truncated.push(['systemPrompt'])
  }
  if (ref?.toolsSameAs) {
    delete rest.tools
    capper.truncated.push(['tools'])
  }
  // The references are added after capping: they are ids, and their keys must stay whole.
  const payload: Record<string, unknown> = { ...capper.record(rest, []), ...ref }
  if (capper.truncated.length > 0) {
    payload.$truncated = capper.truncated
  }
  const { original: _original, ...fields } = event
  return { ...fields, payload, source: { ...event.source, file: fileIndex(event.source.file) } }
}

/** One entry per file and reason, with the first line and a count. */
function groupSkipped(skipped: readonly SkippedRecord[], max: number): SkippedRecord[] {
  const groups = new Map<string, SkippedRecord>()
  for (const entry of skipped) {
    const key = `${entry.file}\0${entry.reason}`
    const group = groups.get(key)
    if (group) {
      group.count = (group.count ?? 1) + (entry.count ?? 1)
    } else {
      groups.set(key, { file: entry.file, line: entry.line, reason: cut(entry.reason, max), count: entry.count ?? 1 })
    }
  }
  return [...groups.values()]
}

function capLane(lane: Lane, max: number): Lane {
  const out = { ...lane }
  if (out.title !== undefined && out.title.length > max) {
    out.title = cut(out.title, max)
  }
  if (out.systemPrompt !== undefined && out.systemPrompt.length > max) {
    out.systemPrompt = cut(out.systemPrompt, max)
  }
  return out
}

/** A view before its check: the capped session and events are `unknown` to the type system. */
interface ViewDraft {
  [field: string]: unknown
  view: ViewInfo
}

function draftView(trace: Trace, max: number): ViewDraft {
  const capper = new Capper(max)
  const { $truncated: _previous, ...rest } = trace.session
  const session = capper.record(rest, [])
  if (capper.truncated.length > 0) {
    session.$truncated = capper.truncated
  }
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
  const refs = repeatedSnapshots(trace.events)
  return {
    ...base,
    session,
    agents: trace.agents.map(lane => capLane(lane, max)),
    events: trace.events.map(event => capEvent(event, max, fileIndex, refs)),
    skipped: groupSkipped(trace.skipped, max),
    sourceFiles: [...files.keys()],
    view: { maxString: max },
  }
}

/**
 * The trace the browser receives (D6, plan 3.3). Pure: the input is not changed.
 *
 * - Drops `original`; `get-event` reads it back from the source pointer.
 * - Caps every string and object key at `maxString` UTF-16 units (default
 *   4,096; a value below 256 is raised to 256), never splitting a surrogate
 *   pair, and lists the shortened paths in `payload.$truncated` (and
 *   `session.$truncated`) as key/index arrays. `agents[].title` and
 *   `skipped[].reason` are capped too.
 * - Interns source files: `sourceFiles` lists them once and each event's
 *   `source.file` is its index, so `file` + `line` still names one record.
 * - Merges `skipped` entries per file and reason, with a count.
 * - Keeps each distinct prompt snapshot system prompt and non-empty tool list
 *   once, on the first snapshot that has it; a later snapshot with the same
 *   content names that holder in `systemPromptSameAs` / `toolsSameAs` and lists
 *   the field in `payload.$truncated`, so the inspector loads it via `get-event`.
 * - Records the cap in `view.maxString`, so the UI can say how text was shortened.
 *
 * The result is checked against the trace schema before it is returned, and a
 * failed check throws. Capping keeps every string a string and, at 256 or more
 * (`MIN_STRING`), cuts no declared key or enum value, so the check fails only
 * when the input already breaks the schema, such as a `NaN` timestamp.
 */
export function toView(trace: Trace, opts?: { maxString?: number }): Trace {
  const draft = draftView(trace, capFor(opts?.maxString))
  assertTrace(draft, 'toView')
  return draft
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

function fitted(draft: ViewDraft, bytes: number): FittedView {
  assertTrace(draft, 'fitView')
  return { trace: draft, bytes }
}

/**
 * `toView` within a byte budget. Sessions whose view fits keep the starting cap
 * (`maxString`, 4,096 by default, never below 256); larger ones get a lower cap,
 * in steps of 0.75, down to 256 characters. At the floor the view is returned
 * anyway with `view.withinBudget: false`. Only the view it returns is checked,
 * not every cap it measures on the way.
 */
export function fitView(trace: Trace, opts?: { maxString?: number; maxBytes?: number }): FittedView {
  const budget = opts?.maxBytes ?? VIEW_BUDGET_BYTES
  let max = capFor(opts?.maxString)
  while (true) {
    const draft = draftView(trace, max)
    draft.view = { maxString: max, budgetBytes: budget, withinBudget: true }
    const bytes = jsonBytes(draft)
    if (bytes <= budget) {
      return fitted(draft, bytes)
    }
    if (max <= MIN_STRING) {
      draft.view.withinBudget = false
      // `false` is one byte longer than `true`.
      return fitted(draft, bytes + 1)
    }
    max = Math.max(MIN_STRING, Math.floor(max * STEP))
  }
}
