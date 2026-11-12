import type { RequestEntry } from '@rivus/estela-kernel'
import type { LedgerModel } from './ledger-model.ts'

/** The requests the selected one can be compared with, and the two quick picks. */
export interface CompareChoices {
  /** The other requests on the selected request's lane, in trace order. */
  options: RequestEntry[]
  /** The request just before the selected one on its lane. */
  previous: string | undefined
  /**
   * The last request on the lane before the latest compaction that precedes the selected request;
   * `undefined` when no compaction lies between a request of the lane and the selected one.
   */
  beforeCompaction: string | undefined
}

const NONE: CompareChoices = { options: [], previous: undefined, beforeCompaction: undefined }

/** Compare targets for `eventId`, a request; any other event has none. */
export function compareChoices(model: LedgerModel, eventId: string): CompareChoices {
  const found = model.requests.get(eventId)
  if (!found) {
    return NONE
  }
  const { lane, index } = found
  const position = new Map(model.trace.events.map((event, at) => [event.id, at]))
  const at = position.get(eventId)!
  const compaction = lane.markers
    .filter(marker => marker.kind === 'compaction')
    .map(marker => position.get(marker.eventId) ?? -1)
    .filter(place => place >= 0 && place < at)
    .at(-1)
  const beforeCompaction =
    compaction === undefined
      ? undefined
      : lane.requests.filter(request => (position.get(request.id) ?? Infinity) < compaction).at(-1)?.id
  return {
    options: lane.requests.filter(request => request.id !== eventId),
    previous: index > 0 ? lane.requests[index - 1]!.id : undefined,
    beforeCompaction,
  }
}

/**
 * The request to compare with: the user's pick when it is still another request of the lane, else
 * the previous request, else (the lane's first request) the next one.
 */
export function compareTarget(choices: CompareChoices, picked: string | undefined): string | undefined {
  if (picked !== undefined && choices.options.some(option => option.id === picked)) {
    return picked
  }
  return choices.previous ?? choices.options[0]?.id
}
