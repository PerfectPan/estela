import type { Transcript } from '@rivus/agent-kit/transcript'
import { laneOf, mainAgentId } from '@rivus/agent-kit/transcript'
import { PROMPT_CHARS, PROMPT_LIMIT } from '@rivus/agent-trace-runtime-node'

/**
 * Main-agent user text from the transcript, for search: the index's `PROMPT_LIMIT` prompts,
 * `PROMPT_CHARS` characters each. Read from the transcript the summary already loads; the kit's
 * bounded summary pass with prompts is tracked in PerfectPan/agent-kit#70.
 */
export function userPrompts(transcript: Transcript): string[] {
  const main = mainAgentId(transcript)
  const prompts: string[] = []
  for (const event of transcript.events) {
    if (event.kind !== 'user' || (event.agentId != null && laneOf(event, main) !== main)) {
      continue
    }
    const text = event.payload.text
    if (typeof text !== 'string') {
      continue
    }
    const trimmed = text.trim()
    if (!trimmed) {
      continue
    }
    prompts.push(trimmed.slice(0, PROMPT_CHARS))
    if (prompts.length >= PROMPT_LIMIT) {
      break
    }
  }
  return prompts
}
