import type { TraceEvent } from '@rivus/agent-trace-schema'
import { asNumber, asRecord, asString } from '@rivus/agent-trace-kernel'

/**
 * User-role text that Codex injects: environment, instructions, notifications.
 * These are not user prompts.
 */
export const INJECTED_USER =
  /^\s*(?:<(?:environment_context|user_instructions|turn_aborted|subagent_notification|skill|recommended_plugins|heartbeat|goal_context|codex_delegation|hook_prompt|codex_internal_context)>|# AGENTS\.md instructions)/

export function textFrom(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return undefined
  }
  const parts: string[] = []
  for (const part of content) {
    const rec = asRecord(part)
    const text = asString(rec?.text) ?? asString(rec?.output)
    if (text) {
      parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join('') : undefined
}

function argsOf(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/** Exit-code headers Codex writes before a shell tool's output. */
const EXIT_LINE = /^(?:Exit code: |Process exited with code )(-?\d+)$/m

/**
 * Exit code of a tool output: `metadata.exit_code` of a JSON output, or the
 * `Exit code:` / `Process exited with code` header line before `Output:`.
 */
function exitCodeOf(output: unknown): number | undefined {
  if (typeof output !== 'string') {
    return undefined
  }
  if (output.startsWith('{')) {
    try {
      const code = asNumber(asRecord(asRecord(JSON.parse(output) as unknown)?.metadata)?.exit_code)
      if (code !== undefined) {
        return code
      }
    } catch {
      // Not JSON; read the text header below.
    }
  }
  const header = output.split('\nOutput:', 1)[0]!.split('\n', 6).join('\n')
  const match = EXIT_LINE.exec(header)
  return match ? Number(match[1]) : undefined
}

function resultFlags(payload: Record<string, unknown>): { isError?: boolean; exitCode?: number } {
  const exitCode = exitCodeOf(payload.output)
  return exitCode === undefined ? {} : { exitCode, isError: exitCode !== 0 }
}

export function emitInner(
  inner: string,
  payload: Record<string, unknown>,
  emit: (kind: TraceEvent['kind'], body: Record<string, unknown>, id?: string) => TraceEvent,
): TraceEvent | undefined {
  if (inner === 'message') {
    const role = asString(payload.role)
    const text = textFrom(payload.content)
    if (role === 'developer') {
      return emit('system', { ...(text ? { text } : {}), injected: true })
    }
    const kind = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system'
    const injected = kind === 'user' && text !== undefined && INJECTED_USER.test(text)
    return emit(kind, { ...(text ? { text } : {}), ...(injected ? { injected: true } : {}) })
  }
  if (inner === 'agent_message') {
    // A message between agents (`author` → `recipient`), not this model's own reply.
    const text = textFrom(payload.content)
    const author = asString(payload.author)
    const recipient = asString(payload.recipient)
    return emit('system', {
      type: 'agent_message',
      ...(author ? { author } : {}),
      ...(recipient ? { recipient } : {}),
      ...(text ? { text } : {}),
    })
  }
  if (inner === 'web_search_call') {
    const body: Record<string, unknown> = {
      callId: asString(payload.call_id) ?? asString(payload.id) ?? '',
      name: 'web_search',
    }
    if (payload.action !== undefined) {
      body.args = payload.action
    }
    return emit('tool_call', body)
  }
  if (inner === 'tool_search_call') {
    const body: Record<string, unknown> = { callId: asString(payload.call_id) ?? '', name: 'tool_search' }
    if (payload.arguments !== undefined) {
      body.args = payload.arguments
    }
    return emit('tool_call', body)
  }
  if (inner === 'tool_search_output') {
    const status = asString(payload.status)
    return emit('tool_result', {
      callId: asString(payload.call_id) ?? '',
      ...(payload.tools !== undefined ? { output: payload.tools } : {}),
      ...(status === 'failed' || status === 'error' ? { isError: true } : {}),
    })
  }
  if (inner === 'reasoning') {
    const text = textFrom(payload.summary)
    return emit('thinking', text ? { text } : {})
  }
  if (inner === 'function_call' || inner === 'custom_tool_call') {
    const body: Record<string, unknown> = {
      callId: asString(payload.call_id) ?? '',
      name: asString(payload.name) ?? '',
    }
    const args = payload.arguments ?? payload.input
    if (args !== undefined) {
      body.args = argsOf(args)
    }
    return emit('tool_call', body)
  }
  if (inner === 'function_call_output' || inner === 'custom_tool_call_output') {
    const body: Record<string, unknown> = {
      callId: asString(payload.call_id) ?? '',
      ...resultFlags(payload),
    }
    if (payload.output !== undefined) {
      body.output = payload.output
    }
    return emit('tool_result', body)
  }
  if (inner === 'compaction') {
    return undefined
  }
  return emit('unknown', { type: inner })
}
