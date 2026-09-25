import type { PromptSnapshotPayload, TraceEvent } from '@rivus/agent-trace-schema'

/** The payload of a prompt snapshot event (`system`, `type: 'prompt_snapshot'`), else `undefined`. */
export function promptSnapshot(event: TraceEvent): PromptSnapshotPayload | undefined {
  if (event.kind !== 'system' || event.payload.type !== 'prompt_snapshot')
    return undefined
  return event.payload as unknown as PromptSnapshotPayload
}

/** A recorded, non-empty system prompt: the text, or in a view trace a reference to the snapshot that holds it. */
export function snapshotHasSystemPrompt(snapshot: PromptSnapshotPayload | undefined): boolean {
  return (typeof snapshot?.systemPrompt === 'string' && snapshot.systemPrompt.length > 0)
    || typeof snapshot?.systemPromptSameAs === 'string'
}

/** A recorded tool list, possibly empty; in a view trace a repeated non-empty list is a reference. */
export function snapshotHasTools(snapshot: PromptSnapshotPayload | undefined): boolean {
  return Array.isArray(snapshot?.tools) || typeof snapshot?.toolsSameAs === 'string'
}

/** A recorded tool list with no tools in it (`tools: []`). */
export function snapshotToolsEmpty(snapshot: PromptSnapshotPayload | undefined): boolean {
  return Array.isArray(snapshot?.tools) && snapshot.tools.length === 0 && snapshot.toolsSameAs === undefined
}

/** The last event in `events` whose snapshot passes `test`. */
export function latestSnapshot(
  events: readonly TraceEvent[],
  test: (snapshot: PromptSnapshotPayload | undefined) => boolean,
): TraceEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (test(promptSnapshot(event)))
      return event
  }
  return undefined
}
