import type { Trace } from '@rivus/agent-trace-schema'

const PROMPT_LIMIT = 200
const PROMPT_CHARS = 500

/** Main-agent user text from the canonical trace, for search: at most 200 prompts, 500 characters each. */
export function userPrompts(trace: Trace): string[] {
  const main = trace.agents.find(agent => agent.parentId == null)?.id
  const prompts: string[] = []
  for (const event of trace.events) {
    if (event.kind !== 'user' || (event.agentId != null && event.agentId !== main))
      continue
    const text = event.payload.text
    if (typeof text !== 'string')
      continue
    const trimmed = text.trim()
    if (!trimmed)
      continue
    prompts.push(trimmed.slice(0, PROMPT_CHARS))
    if (prompts.length >= PROMPT_LIMIT)
      break
  }
  return prompts
}
