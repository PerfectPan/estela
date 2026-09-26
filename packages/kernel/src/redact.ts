import type { Trace } from '@rivus/agent-trace-schema'

const SECRET = /(?:sk-|AKIA|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g

function homePattern(homeDir: string): RegExp | undefined {
  const root = homeDir.endsWith('/') && homeDir.length > 1 ? homeDir.slice(0, -1) : homeDir
  if (!root || root === '/')
    return undefined
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Continue a segment on a letter, number, "_", "-", or "." plus a name character (.bak).
  // `i` over-redacts mixed case. `u` so non-ASCII letters continue a segment.
  const name = String.raw`\p{L}\p{N}_`
  return new RegExp(`(?<![${name}])${escaped}(?![${name}-]|\\.[${name}])`, 'giu')
}

/** Home-directory and token replacement for one string. `pattern` is built once per `redact` call. */
export function redactText(value: string, homeDir: string, pattern = homePattern(homeDir)): string {
  const replaced = pattern ? value.replace(pattern, '~') : value
  SECRET.lastIndex = 0
  return replaced.replace(SECRET, '[redacted]')
}

function redactValue(value: unknown, homeDir: string, pattern: RegExp | undefined): unknown {
  if (typeof value === 'string')
    return redactText(value, homeDir, pattern)
  if (Array.isArray(value))
    return value.map(item => redactValue(item, homeDir, pattern))
  if (value != null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      out[redactText(key, homeDir, pattern)] = redactValue(item, homeDir, pattern)
    return out
  }
  return value
}

/** Default-on for static export. Mutates nothing; returns a copy. */
export function redact(trace: Trace, options: { homeDir: string }): Trace {
  return redactValue(trace, options.homeDir, homePattern(options.homeDir)) as Trace
}
