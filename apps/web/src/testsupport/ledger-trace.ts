import type { TranscriptEventKind } from '@rivus/agent-kit/transcript'
import type { Trace, TraceEvent, TraceEventPayloads } from '@rivus/estela-schema'
import type { LedgerView } from '@/lib/ledger-model.ts'

/** Test support shared by the ledger's unit tests in both layouts and the workspace state's. */

/** An event's id, a kind with that kind's payload, and any other fields. */
type EventInput = Partial<Omit<TraceEvent, 'kind' | 'payload'>> & { id: string } & {
    [K in TranscriptEventKind]: { kind: K; payload: TraceEventPayloads[K] }
  }[TranscriptEventKind]

/**
 * Events in the long turn and lane tests: more rows than fit as spread arguments on Node's default
 * stack (about 124,000 with Node 26's default `--stack-size`), so code that passes the rows to a
 * function as `...rows` throws a RangeError there. One turn holds them all, so a spread per turn
 * fails too.
 */
export const LONG_EVENT_COUNT = 150_000

/** Building that many rows takes seconds on a busy CI runner, past Vitest's default 5 s. */
export const LONG_TEST_TIMEOUT_MS = 30_000

let seq = 0
/** The next event: `seq` and `ts` (one second a step) count up from the last `sample()`. */
export function event(input: EventInput): TraceEvent {
  const at = seq++
  return { seq: at, ts: 1000 * at, source: { file: '0', offset: 0, length: 1, line: at + 1 }, ...input }
}

/**
 * Two turns on the main lane (requests `r1` and `r2`, a failed tool call, two hooks, a compaction)
 * and one `Explore` subagent spawned by the `spawn` call in the first turn (request `s1`).
 */
export function sample(): Trace {
  seq = 0
  return {
    schema: 'estela',
    agent: 'claude-code',
    session: { id: 's' },
    capabilities: ['requests', 'usage', 'subagents', 'hooks', 'compaction'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'spawn', title: 'Explore' }],
    skipped: [],
    events: [
      event({ id: 'p1', kind: 'user', payload: { text: 'first' } }),
      event({ id: 'r1', kind: 'request', payload: { usage: { inputTokens: 100 } } }),
      event({ id: 'c1', kind: 'tool_call', payload: { callId: 'x1', name: 'Bash', args: { command: 'ls' } } }),
      event({ id: 'o1', kind: 'tool_result', payload: { callId: 'x1', isError: true, exitCode: 1 } }),
      event({ id: 'h1', kind: 'hook', payload: { type: 'hook_success' } }),
      event({ id: 'h2', kind: 'hook', payload: { type: 'hook_success' } }),
      event({ id: 'spawn', kind: 'tool_call', payload: { callId: 'x2', name: 'Task' } }),
      event({ id: 's1', kind: 'request', agentId: 'sub', payload: {} }),
      event({ id: 's2', kind: 'assistant', agentId: 'sub', payload: { text: 'found' } }),
      event({ id: 'spawn-out', kind: 'tool_result', payload: { callId: 'x2' } }),
      event({ id: 'k1', kind: 'compaction', payload: { preTokens: 100, postTokens: 10 } }),
      event({ id: 'p2', kind: 'user', payload: { text: 'second' } }),
      event({ id: 'r2', kind: 'request', payload: {} }),
    ],
  }
}

/** A ledger view with nothing collapsed or expanded, no chip, and no range, unless `partial` says otherwise. */
export const view = (partial: Partial<LedgerView> = {}): LedgerView => ({
  collapsed: new Set(),
  expanded: new Set(),
  filter: 'all',
  ...partial,
})
