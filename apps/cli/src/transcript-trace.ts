import type { Trace } from '@rivus/agent-trace-schema'
import type { Transcript } from '@rivus/agent-kit/transcript'

/**
 * Maps a kit `Transcript` onto the repo's canonical `Trace`: the kit's `Transcript` is what
 * reading produces, `Trace` is the repo-internal model (schema head, `host` block,
 * flattened `skipped`). Event kinds, capabilities, and payload names are the kit's since
 * the schema adopted them.
 */
export function transcriptToTrace(transcript: Transcript): Trace {
  return {
    schema: 'agent-trace',
    host: {
      id: transcript.agent,
      ...(transcript.agentVersion !== undefined ? { version: transcript.agentVersion } : {}),
    },
    session: transcript.session,
    capabilities: [...transcript.capabilities],
    agents: transcript.agents,
    events: transcript.events.map(event => ({ ...event })),
    skipped: transcript.skipped.map(skip => ({
      file: skip.source.file,
      line: skip.source.line,
      reason: skip.reason,
    })),
  }
}
