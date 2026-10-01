import type { RequestPayload } from '@rivus/agent-trace-schema'

export interface UsageParts {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  /**
   * Claude records uncached `input_tokens` separately from cache read/write.
   * OTel `input_tokens` is the total, so those breakdowns are added in.
   * Codex and Grok already report a total; leave this unset for them.
   */
  includeCacheInInput?: boolean
}

/** Build a request usage object. Absent numbers stay absent. */
export function usageFrom(parts: UsageParts): RequestPayload['usage'] | undefined {
  const out: NonNullable<RequestPayload['usage']> = {}
  if (parts.includeCacheInInput) {
    if (parts.input !== undefined || parts.cacheRead !== undefined || parts.cacheWrite !== undefined) {
      out.inputTokens = (parts.input ?? 0) + (parts.cacheRead ?? 0) + (parts.cacheWrite ?? 0)
    }
  } else if (parts.input !== undefined) {
    out.inputTokens = parts.input
  }
  if (parts.output !== undefined) {
    out.outputTokens = parts.output
  }
  if (parts.cacheRead !== undefined) {
    out.cacheReadTokens = parts.cacheRead
  }
  if (parts.cacheWrite !== undefined) {
    out.cacheWriteTokens = parts.cacheWrite
  }
  if (parts.reasoning !== undefined) {
    out.reasoningTokens = parts.reasoning
  }
  return Object.keys(out).length > 0 ? out : undefined
}
