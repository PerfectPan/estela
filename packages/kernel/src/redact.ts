import { isObjectLike } from 'lodash-es'
const SECRET = /(?:sk-|AKIA|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g

function homeRoot(homeDir: string): string {
  return homeDir.endsWith('/') && homeDir.length > 1 ? homeDir.slice(0, -1) : homeDir
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The home directory as it appears in text. The root may sit inside a longer string (`a/<home>/x`
 * in a git diff header, `file://<home>`), so nothing is required before it. A root that starts
 * with `/` also matches without that slash when no name character precedes it (`Users/<name>/x`,
 * a path relative to `/`), and with every `/` escaped as `\/` (JSON written into a string).
 * After the root, a letter, number, `_`, `-`, or `.` plus a name character continues the segment
 * (`<home>x`, `<home>.bak`), so those stay. `i` over-redacts mixed case; `u` so
 * non-ASCII letters continue a segment.
 */
function homePattern(homeDir: string): RegExp | undefined {
  const root = homeRoot(homeDir)
  if (!root || root === '/') {
    return undefined
  }
  const name = String.raw`\p{L}\p{N}_`
  const forms = [escapeRegExp(root)]
  if (root.startsWith('/')) {
    forms.push(`(?<![${name}])${escapeRegExp(root.slice(1))}`)
    forms.push(escapeRegExp(root.replaceAll('/', '\\/')))
  }
  return new RegExp(`(?:${forms.join('|')})(?![${name}-]|\\.[${name}])`, 'giu')
}

/**
 * Encoded forms of the home directory in host directory names: Claude's project
 * slug replaces every character other than an ASCII letter or digit with `-`;
 * Grok percent-encodes each path segment and joins them with `%2F`.
 */
function encodedHomePattern(homeDir: string): RegExp | undefined {
  const root = homeRoot(homeDir)
  if (!root || root === '/') {
    return undefined
  }
  const dash = escapeRegExp(root.replace(/[^A-Za-z0-9]/g, '-'))
  const encoded = escapeRegExp(
    root
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('%2F'),
  )
  const name = String.raw`\p{L}\p{N}_`
  return new RegExp(`(?<![${name}%])(?:${encoded}|${dash})(?![${name}])`, 'giu')
}

/** Home-directory and token replacement for one string. `pattern` is built once per `redact` call. */
export function redactText(
  value: string,
  homeDir: string,
  pattern = homePattern(homeDir),
  encoded = encodedHomePattern(homeDir),
): string {
  const dashed = encoded ? value.replace(encoded, '~') : value
  const replaced = pattern ? dashed.replace(pattern, '~') : dashed
  SECRET.lastIndex = 0
  return replaced.replace(SECRET, '[redacted]')
}

function redactValue(
  value: unknown,
  homeDir: string,
  pattern: RegExp | undefined,
  encoded: RegExp | undefined,
): unknown {
  if (typeof value === 'string') {
    return redactText(value, homeDir, pattern, encoded)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, homeDir, pattern, encoded))
  }
  if (isObjectLike(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[redactText(key, homeDir, pattern, encoded)] = redactValue(item, homeDir, pattern, encoded)
    }
    return out
  }
  return value
}

/**
 * Home-directory and token replacement in any JSON value: a trace, one event,
 * an original record, or an error message. Default-on for static export.
 * Mutates nothing; returns a copy.
 */
export function redact<T>(value: T, options: { homeDir: string }): T {
  return redactValue(value, options.homeDir, homePattern(options.homeDir), encodedHomePattern(options.homeDir)) as T
}
