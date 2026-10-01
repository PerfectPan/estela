import type { AgentInfo, Capability, PromptSnapshotPayload, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { SourcedRecord } from '@rivus/agent-trace-kernel'
import {
  asString,
  generationError,
  latestSnapshot,
  promptSnapshot,
  snapshotHasSystemPrompt,
  snapshotHasTools,
} from '@rivus/agent-trace-kernel'

/** Blocks of a recorded `systemPrompt` array are joined with a blank line; the original keeps the blocks. */
const BLOCK_SEPARATOR = '\n\n'

/**
 * `attachment.type: 'prompt_snapshot'` (Claude Code, seen from 2.1.268): the
 * system prompt the CLI sent, as a string array, and on some snapshots the
 * tool list (`tools[].schema.input_schema`) and `cliPrefix`. A field of another
 * shape is an unknown generation.
 */
export function snapshotPayload(attachment: Record<string, unknown>, record: SourcedRecord): Record<string, unknown> {
  const payload: Record<string, unknown> & PromptSnapshotPayload = { type: 'prompt_snapshot' }
  const prompt = attachment.systemPrompt
  if (typeof prompt === 'string') {
    if (prompt) {
      payload.systemPrompt = prompt
    }
  } else if (Array.isArray(prompt) && prompt.every(block => typeof block === 'string')) {
    const text = prompt.join(BLOCK_SEPARATOR)
    if (text) {
      payload.systemPrompt = text
    }
  } else if (prompt !== undefined) {
    throw generationError('claude-code', record.file, record.line)
  }
  if (Array.isArray(attachment.tools)) {
    payload.tools = attachment.tools
  } else if (attachment.tools !== undefined) {
    throw generationError('claude-code', record.file, record.line)
  }
  const cliPrefix = asString(attachment.cliPrefix)
  if (cliPrefix) {
    payload.cliPrefix = cliPrefix
  }
  return payload
}

/**
 * Session and lane fields from the snapshots: the session system prompt and
 * tools come from the main lane's latest snapshot that recorded each, a
 * subagent's system prompt from its own lane's latest one.
 */
export function applySnapshots(events: readonly TraceEvent[], agents: AgentInfo[], session: Trace['session']): void {
  const byLane = new Map<string, TraceEvent[]>()
  for (const event of events) {
    if (!promptSnapshot(event)) {
      continue
    }
    const lane = event.agentId ?? 'main'
    byLane.set(lane, [...(byLane.get(lane) ?? []), event])
  }
  const main = byLane.get('main') ?? []
  const system = latestSnapshot(main, snapshotHasSystemPrompt)
  if (system) {
    session.systemPrompt = promptSnapshot(system)!.systemPrompt!
  }
  const tools = latestSnapshot(main, snapshotHasTools)
  if (tools) {
    session.tools = promptSnapshot(tools)!.tools
  }
  for (const agent of agents) {
    if (agent.id === 'main') {
      continue
    }
    const own = latestSnapshot(byLane.get(agent.id) ?? [], snapshotHasSystemPrompt)
    if (own) {
      agent.systemPrompt = promptSnapshot(own)!.systemPrompt!
    }
  }
}

/** `systemPrompt` and `toolSchemas` for a trace whose files contain snapshots that record them. */
export function snapshotCapabilities(events: readonly TraceEvent[]): Capability[] {
  const out: Capability[] = []
  if (latestSnapshot(events, snapshotHasSystemPrompt)) {
    out.push('systemPrompt')
  }
  if (latestSnapshot(events, snapshotHasTools)) {
    out.push('toolSchemas')
  }
  return out
}
