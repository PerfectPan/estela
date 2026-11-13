import type {
  ContextSlot,
  ContextSlotName,
  ReconstructResult,
  Trace,
  TraceEvent,
  TracePromptSnapshotPayload,
} from '@rivus/estela-schema'
import { z } from 'zod/mini'
import { laneOf, mainAgentId } from './lanes.ts'
import { promptSnapshot } from './prompt-snapshot.ts'
import { reconstruct } from './reconstruct.ts'

type SlotStatus = ContextSlot['status']

/**
 * One slot compared between two requests. `unavailable` when either side's log does not record
 * the slot: nothing is compared, so no event is listed as added or removed.
 */
export type SlotDiff =
  | { name: ContextSlotName; change: 'unavailable'; before: SlotStatus; after: SlotStatus }
  | {
      name: ContextSlotName
      change: 'compared'
      before: SlotStatus
      after: SlotStatus
      /** In the slot after, not before; an event can arrive from another slot (a turn that ended moves to messages). */
      added: string[]
      /** In the slot before, not after. */
      removed: string[]
      unchanged: string[]
    }

/** The system prompt compared by content: the recorded text, or in a view trace the snapshot that holds it. */
export type SystemDiff = { change: 'unavailable' } | { change: 'same' | 'changed' }

/**
 * The tool list compared by content. On a change, the tool names that entered and left, or
 * `undefined` when a definition on either side carries no name to read.
 */
export type ToolsDiff =
  | { change: 'unavailable' }
  | { change: 'same' }
  | { change: 'changed'; added: string[] | undefined; removed: string[] | undefined }

/** Recorded input tokens of each request; the delta only when both are recorded. */
export interface TokenDiff {
  before: number | undefined
  after: number | undefined
  delta: number | undefined
}

export interface ContextDiffResult {
  status: 'compared'
  lane: string
  /** The earlier of the two events in trace order, whatever order they were passed in. */
  beforeId: string
  afterId: string
  /** Compaction events on the lane after `beforeId`, up to and including `afterId`. */
  compactionIds: string[]
  /** Events in a slot after that were in no slot before. */
  entered: string[]
  /** Events in a slot before that are in no slot after. */
  left: string[]
  /**
   * Events a compaction between the two hid (`shadowedBy`): removed at `afterId` and not at
   * `beforeId`. It includes hidden events that were in no slot at `beforeId`: records outside the slots
   * (requests, prompt snapshots, hooks), and events that came after `beforeId`; `left` is the part that was.
   */
  compacted: string[]
  slots: SlotDiff[]
  system: SystemDiff
  tools: ToolsDiff
  /** From `request.inputTokens` only; never estimated, never split per slot. */
  inputTokens: TokenDiff
}

export type ContextDiffRejection =
  | { status: 'rejected'; reason: 'event-not-found'; missing: string[] }
  /** Each lane is its own model conversation, so their event sets have nothing to diff. */
  | { status: 'rejected'; reason: 'different-lanes'; lanes: [string, string] }

export type ContextDiff = ContextDiffResult | ContextDiffRejection

/** The two tool definition shapes the kit's adapters record: `{ name }` and `{ function: { name } }`. */
const toolNameSchema = z.union([z.object({ name: z.string() }), z.object({ function: z.object({ name: z.string() }) })])

function toolNames(tools: readonly unknown[]): string[] | undefined {
  const names: string[] = []
  for (const tool of tools) {
    const parsed = toolNameSchema.safeParse(tool)
    if (!parsed.success) {
      return undefined
    }
    names.push('name' in parsed.data ? parsed.data.name : parsed.data.function.name)
  }
  return names
}

function slotOf(result: ReconstructResult, name: ContextSlotName): ContextSlot {
  return result.slots?.find(item => item.name === name) ?? { name, status: 'unavailable', eventIds: [] }
}

function compareSlot(before: ContextSlot, after: ContextSlot): SlotDiff {
  if (before.status === 'unavailable' || after.status === 'unavailable') {
    return { name: before.name, change: 'unavailable', before: before.status, after: after.status }
  }
  const was = new Set(before.eventIds)
  const now = new Set(after.eventIds)
  return {
    name: before.name,
    change: 'compared',
    before: before.status,
    after: after.status,
    added: after.eventIds.filter(id => !was.has(id)),
    removed: before.eventIds.filter(id => !now.has(id)),
    unchanged: after.eventIds.filter(id => was.has(id)),
  }
}

/**
 * The snapshot holding a field's content: a view trace replaces a repeated value with a
 * reference to the first snapshot that has it (`systemPromptSameAs` / `toolsSameAs`), compared
 * on the full value before any cap, so two different holders in a view always differ.
 */
function holder(
  byId: ReadonlyMap<string, TraceEvent>,
  id: string,
  sameAs: (snapshot: TracePromptSnapshotPayload) => string | undefined,
): { id: string; snapshot: TracePromptSnapshotPayload | undefined } {
  const own = byId.get(id)
  const ownSnapshot = own ? promptSnapshot(own) : undefined
  const ref = ownSnapshot ? sameAs(ownSnapshot) : undefined
  if (ref === undefined) {
    return { id, snapshot: ownSnapshot }
  }
  const target = byId.get(ref)
  return { id: ref, snapshot: target ? promptSnapshot(target) : undefined }
}

function truncated(snapshot: TracePromptSnapshotPayload | undefined, field: string): boolean {
  return snapshot?.$truncated?.some(path => path[0] === field) ?? false
}

/** Same holder, or (outside a view) equal recorded values; a value the view cut is never called equal by text. */
function sameContent<T>(
  a: { id: string; snapshot: TracePromptSnapshotPayload | undefined },
  b: { id: string; snapshot: TracePromptSnapshotPayload | undefined },
  field: 'systemPrompt' | 'tools',
  key: (snapshot: TracePromptSnapshotPayload) => T,
): boolean {
  if (a.id === b.id) {
    return true
  }
  if (!a.snapshot || !b.snapshot || truncated(a.snapshot, field) || truncated(b.snapshot, field)) {
    return false
  }
  return key(a.snapshot) === key(b.snapshot)
}

function compareSystem(byId: ReadonlyMap<string, TraceEvent>, before: ContextSlot, after: ContextSlot): SystemDiff {
  if (before.status === 'unavailable' || after.status === 'unavailable') {
    return { change: 'unavailable' }
  }
  // Without snapshots both come from the same session or lane field.
  if (before.recordedBy === undefined || after.recordedBy === undefined) {
    return { change: before.recordedBy === after.recordedBy ? 'same' : 'changed' }
  }
  const sameAs = (snapshot: TracePromptSnapshotPayload) => snapshot.systemPromptSameAs
  const same = sameContent(
    holder(byId, before.recordedBy, sameAs),
    holder(byId, after.recordedBy, sameAs),
    'systemPrompt',
    snapshot => snapshot.systemPrompt,
  )
  return { change: same ? 'same' : 'changed' }
}

function toolList(snapshot: TracePromptSnapshotPayload | undefined): readonly unknown[] | undefined {
  return snapshot?.tools
}

function compareTools(byId: ReadonlyMap<string, TraceEvent>, before: ContextSlot, after: ContextSlot): ToolsDiff {
  if (before.status === 'unavailable' || after.status === 'unavailable') {
    return { change: 'unavailable' }
  }
  if (before.recordedBy === undefined || after.recordedBy === undefined) {
    return before.recordedBy === after.recordedBy
      ? { change: 'same' }
      : { change: 'changed', added: undefined, removed: undefined }
  }
  const sameAs = (snapshot: TracePromptSnapshotPayload) => snapshot.toolsSameAs
  const was = holder(byId, before.recordedBy, sameAs)
  const now = holder(byId, after.recordedBy, sameAs)
  if (sameContent(was, now, 'tools', snapshot => JSON.stringify(snapshot.tools))) {
    return { change: 'same' }
  }
  const wasTools = toolList(was.snapshot)
  const nowTools = toolList(now.snapshot)
  const wasNames = wasTools ? toolNames(wasTools) : undefined
  const nowNames = nowTools ? toolNames(nowTools) : undefined
  if (!wasNames || !nowNames) {
    return { change: 'changed', added: undefined, removed: undefined }
  }
  return {
    change: 'changed',
    added: nowNames.filter(name => !wasNames.includes(name)),
    removed: wasNames.filter(name => !nowNames.includes(name)),
  }
}

function inputTokensOf(result: ReconstructResult): number | undefined {
  return result.tokens?.find(group => group.from === 'request.inputTokens')?.tokens
}

function slotIds(result: ReconstructResult): Set<string> {
  return new Set((result.slots ?? []).flatMap(item => item.eventIds))
}

/**
 * What changed in the model-visible context from one event to another on the same lane: both
 * are `reconstruct`ed, so the same rules hold (lane-scoped prefix, `shadowedBy`, prompt
 * snapshots, `unavailable` for what the log does not record). The two ids may come in either
 * order; the result runs from the earlier to the later. Token counts are the recorded input
 * tokens only; nothing is estimated or split per slot. Events on different lanes are rejected:
 * each lane is a separate conversation.
 */
export function diffContext(trace: Trace, firstId: string, secondId: string): ContextDiff {
  const position = new Map<string, number>()
  trace.events.forEach((event, index) => position.set(event.id, index))
  const missing = [firstId, secondId].filter(id => !position.has(id))
  if (missing.length > 0) {
    return { status: 'rejected', reason: 'event-not-found', missing: [...new Set(missing)] }
  }
  const [beforeId, afterId] =
    position.get(firstId)! <= position.get(secondId)! ? [firstId, secondId] : [secondId, firstId]
  const mainId = mainAgentId(trace)
  const beforeEvent = trace.events[position.get(beforeId)!]!
  const afterEvent = trace.events[position.get(afterId)!]!
  const lane = laneOf(beforeEvent, mainId)
  const afterLane = laneOf(afterEvent, mainId)
  if (lane !== afterLane) {
    return { status: 'rejected', reason: 'different-lanes', lanes: [lane, afterLane] }
  }

  const before = reconstruct(trace, beforeId)
  const after = reconstruct(trace, afterId)
  const byId = new Map(trace.events.map(event => [event.id, event]))
  const wasIn = slotIds(before)
  const nowIn = slotIds(after)
  const removedBefore = new Set(before.removedIds ?? [])
  const names = (after.slots ?? []).map(item => item.name)
  const beforeTokens = inputTokensOf(before)
  const afterTokens = inputTokensOf(after)
  return {
    status: 'compared',
    lane,
    beforeId,
    afterId,
    compactionIds: trace.events
      .slice(position.get(beforeId)! + 1, position.get(afterId)! + 1)
      .filter(event => event.kind === 'compaction' && laneOf(event, mainId) === lane)
      .map(event => event.id),
    entered: [...nowIn].filter(id => !wasIn.has(id)),
    left: [...wasIn].filter(id => !nowIn.has(id)),
    compacted: (after.removedIds ?? []).filter(id => !removedBefore.has(id)),
    slots: names.map(name => compareSlot(slotOf(before, name), slotOf(after, name))),
    system: compareSystem(byId, slotOf(before, 'system'), slotOf(after, 'system')),
    tools: compareTools(byId, slotOf(before, 'tools'), slotOf(after, 'tools')),
    inputTokens: {
      before: beforeTokens,
      after: afterTokens,
      delta: beforeTokens !== undefined && afterTokens !== undefined ? afterTokens - beforeTokens : undefined,
    },
  }
}
