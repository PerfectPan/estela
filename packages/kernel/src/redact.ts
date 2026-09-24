import type { Trace } from '@rivus/agent-trace-schema'

const SECRET = /(?:sk-|AKIA|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g

function replaceHome(value: string, home: string): string {
  const root = home.endsWith('/') && home.length > 1 ? home.slice(0, -1) : home
  if (!root || root === '/')
    return value
  let out = ''
  let index = 0
  while (index <= value.length) {
    const at = value.indexOf(root, index)
    if (at < 0) {
      out += value.slice(index)
      break
    }
    const before = at === 0 ? '' : value[at - 1] ?? ''
    const after = value[at + root.length] ?? ''
    const beforeOk = at === 0 || !/[A-Za-z0-9_]/.test(before)
    const afterOk = after === '' || after === '/' || after === '\\' || /[\s"'`,}]/.test(after)
    if (beforeOk && afterOk) {
      out += `${value.slice(index, at)}~`
      index = at + root.length
    }
    else {
      out += value.slice(index, at + root.length)
      index = at + root.length
    }
  }
  return out
}

function redactString(value: string, home: string): string {
  return replaceHome(value, home).replace(SECRET, '[redacted]')
}

function redactValue(value: unknown, home: string): unknown {
  if (typeof value === 'string')
    return redactString(value, home)
  if (Array.isArray(value))
    return value.map(item => redactValue(item, home))
  if (value != null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      out[key] = redactValue(item, home)
    return out
  }
  return value
}

/** Default-on for static export. Mutates nothing; returns a copy. */
export function redact(trace: Trace, options: { homeDir: string }): Trace {
  return redactValue(trace, options.homeDir) as Trace
}
