import { redactText } from '@rivus/agent-kit/redact'
import { homeDir } from '@rivus/estela-runtime-node'
import { isPlainObject } from 'es-toolkit/predicate'

/** Session text with every home directory hidden, as a list row or an error shows it. */
export type Redactor = (text: string) => string

/** How one server redacts: a whole value (every string in it) or one string. */
export interface HomeRedaction {
  value: <T>(value: T) => T
  text: Redactor
  /** The homes it hides, longest first. */
  homes: readonly string[]
}

/**
 * `shown` itself, or the first of `shown#2`, `shown#3`, … that `taken` does not hold yet; either way, then taken.
 * `next` is where the search for `shown` ended, so many keys that redact to one text each take one step
 * instead of one for every key before them.
 */
function freeKey(shown: string, taken: Set<string>, next: Map<string, number>): string {
  let key = shown
  if (taken.has(key)) {
    let suffix = next.get(shown) ?? 2
    while (taken.has(key)) {
      key = `${shown}#${suffix++}`
    }
    next.set(shown, suffix)
  }
  taken.add(key)
  return key
}

/**
 * `text` applied to every string of a JSON-like value, object keys included. Two keys that redact to the same text
 * keep both their values: a later one gets `#2`, `#3`, … after the shown key, as `toView` tells apart keys it cut
 * to one length. A key is a path or a token an agent recorded, so a value must not vanish with it. Each key is
 * checked against the ones already taken, and the object is built by `Object.fromEntries`, so no value overwrites
 * another and a `__proto__` key stays an own property.
 */
function everyString<T>(value: T, text: Redactor): T {
  // The walk changes strings only, so the value keeps its type.
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return text(item)
    }
    if (Array.isArray(item)) {
      return item.map(walk)
    }
    if (isPlainObject(item)) {
      const taken = new Set<string>()
      const next = new Map<string, number>()
      return Object.fromEntries(
        Object.entries(item).map(([key, field]) => [freeKey(text(key), taken, next), walk(field)]),
      )
    }
    return item
  }
  return walk(value) as T
}

/**
 * Redaction with every home in `homes`: one pass of the kit's `redactText` per home, since its patterns cover one
 * home at a time. A home that is inside another (`/srv/users/alice` in `/srv/users`) is replaced first: the
 * other way its parent would already have turned `/srv/users/alice/notes` into `~/alice/notes`.
 */
export function homeRedaction(...homes: readonly string[]): HomeRedaction {
  const unique = [...new Set(homes)].toSorted((a, b) => b.length - a.length)
  return {
    // Whole-value passes one after the other: the kit builds its patterns per home and keeps only the last
    // built, so a value walked string by string with alternating homes would rebuild them for each string.
    value: <T>(value: T): T =>
      unique.reduce((passed, home) => everyString(passed, text => redactText(text, { home })), value),
    text: text => unique.reduce((passed, home) => redactText(passed, { home }), text),
    homes: unique,
  }
}

/**
 * The redaction of one server, in its always-redacting outputs (reports, MCP tool results and errors, list rows'
 * working directories and read errors, the index's own failure reason).
 *
 * Two homes, because either can be in what a server sends out. Recorded session content (titles, prompts, event
 * text, a session's working directory) names the home of whoever ran the agent, which is `platform.home`; it can
 * also name the home of the user the server runs as, such as a tool output that printed a shell path. What the
 * server itself produces, such as a report build's error message, names the process home. The CLI's platform
 * home is the process home, so its outputs are passed through once.
 */
export function serverRedaction(home: string): HomeRedaction {
  return homeRedaction(home, homeDir())
}
