import type { Trace } from '@rivus/agent-trace-schema'
import { PROMPT_CHARS, PROMPT_LIMIT } from '@rivus/agent-trace-runtime-node'

/** Main-agent user text from the canonical trace, for search: the index's `PROMPT_LIMIT` prompts, `PROMPT_CHARS` characters each. */
export function userPrompts(trace: Trace): string[] {
  const main = trace.agents.find(agent => agent.parentId == null)?.id
  const prompts: string[] = []
  for (const event of trace.events) {
    if (event.kind !== 'user' || (event.agentId != null && event.agentId !== main)) {
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
