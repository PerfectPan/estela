import type { Trace } from '@rivus/agent-trace-schema'
import type { Transcript } from '@rivus/agent-kit/transcript'

/**
 * Maps a kit `Transcript` onto the repo's canonical `Trace`: the kit's `Transcript` is what
 * reading produces, `Trace` is the repo-internal model (schema head, flattened `skipped`).
 * `Trace.events` are the kit's events themselves: the kit parsed the agent's records at its
 * boundary and types each payload by kind, which is the type `TraceEvent` is built on, so the
 * events need no copy, parse, or cast here.
 */
export function transcriptToTrace(transcript: Transcript): Trace {
  return {
    schema: 'agent-trace',
    agent: transcript.agent,
    ...(transcript.agentVersion !== undefined ? { agentVersion: transcript.agentVersion } : {}),
    session: transcript.session,
    capabilities: [...transcript.capabilities],
    agents: transcript.agents,
    events: transcript.events,
    skipped: transcript.skipped.map(skip => ({
      file: skip.source.file,
      line: skip.source.line,
      reason: skip.reason,
    })),
  }
}
