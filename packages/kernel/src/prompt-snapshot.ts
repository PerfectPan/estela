import type { PromptSnapshotPayload, TraceEvent, TraceEventPayloads } from '@rivus/agent-trace-schema'

/**
 * A literal comparison on a payload already typed as a `system` payload, not a check on unknown data: a
 * `PromptSnapshotPayload` is a `system` payload whose `type` is `prompt_snapshot`, and TypeScript narrows on a
 * field's value only within a union, which a `system` payload is not.
 */
function isPromptSnapshot(payload: TraceEventPayloads['system']): payload is PromptSnapshotPayload {
  return payload.type === 'prompt_snapshot'
}

/** The payload of a prompt snapshot event (`system`, `type: 'prompt_snapshot'`), else `undefined`. */
export function promptSnapshot(event: TraceEvent): PromptSnapshotPayload | undefined {
  return event.kind === 'system' && isPromptSnapshot(event.payload) ? event.payload : undefined
}

/** A recorded, non-empty system prompt: the text, or in a view trace a reference to the snapshot that holds it. */
export function snapshotHasSystemPrompt(snapshot: PromptSnapshotPayload | undefined): boolean {
  return (
    (snapshot?.systemPrompt !== undefined && snapshot.systemPrompt.length > 0)
    || snapshot?.systemPromptSameAs !== undefined
  )
}

/** A recorded tool list, possibly empty; in a view trace a repeated non-empty list is a reference. */
export function snapshotHasTools(snapshot: PromptSnapshotPayload | undefined): boolean {
  return snapshot?.tools !== undefined || snapshot?.toolsSameAs !== undefined
}

/** A recorded tool list with no tools in it (`tools: []`). */
export function snapshotToolsEmpty(snapshot: PromptSnapshotPayload | undefined): boolean {
  return snapshot?.tools !== undefined && snapshot.tools.length === 0 && snapshot.toolsSameAs === undefined
}

/** The last event in `events` whose snapshot passes `test`. */
export function latestSnapshot(
  events: readonly TraceEvent[],
  test: (snapshot: PromptSnapshotPayload | undefined) => boolean,
): TraceEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (test(promptSnapshot(event))) {
      return event
    }
  }
  return undefined
}
