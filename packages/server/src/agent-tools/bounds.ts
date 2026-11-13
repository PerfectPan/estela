/**
 * Size bounds every agent tool result keeps (`docs/reference/mcp-tools.md`). A result is one JSON text in an MCP reply; MCP clients cap
 * what they pass to the model (Claude Code warns above 10,000 tokens), so a serialized result stays at or under
 * `RESULT_CHARS` UTF-16 units, about 10,000 to 13,000 tokens of JSON.
 */
export const RESULT_CHARS = 40_000

/** A title or a project name in a list. */
export const TITLE_CHARS = 200
/** A prompt in a list: enough to recognize it; `estela_get_event` reads it whole. */
export const PROMPT_CHARS = 300
/** A path in a list or a summary (a working directory, a log file). */
export const PATH_CHARS = 300
/** Any other recorded string in a list (a model name, a finish reason, a lane title). */
export const FIELD_CHARS = 128
/** Ids per id list inside one item (a turn's failed tools, a request's events). */
export const ITEM_IDS = 20
/** Ids per id list in a reconstruction: the last ones, which are nearest the event. */
export const SURFACE_IDS = 100
/** Lanes in a session summary. */
export const SUMMARY_LANES = 50

/** How a tool redacts: a whole value (deep), one string, or one string that was already cut before it was redacted. */
export interface Redaction {
  value: <T>(value: T) => T
  text: (text: string) => string
  /** `text`, plus a home path cut short at the end replaced with `~`; see `trimCutHome`. */
  cutText: (text: string) => string
}

/** A character that can sit inside a path: before a fragment, it means the fragment is not where a path starts. */
const PATH_CHAR = /[\w.~/\\%-]/

/**
 * `text` (already redacted) with a trailing partial home path replaced by `~`. The kit cuts session titles and first
 * prompts (to 80 and 500 characters) before anything redacts them, and the kit's redaction matches only a whole home
 * path, so a cut inside one would keep the start of the user name. This handles the spellings that can
 * end such a cut: the absolute path, the path without its leading `/`, and the JSON-escaped path. It goes away once
 * the kit cuts after redacting.
 */
export function trimCutHome(text: string, home: string): string {
  const spellings = [home, home.replace(/^\//, ''), home.replaceAll('/', '\\/')]
  for (const spelling of spellings) {
    // Only a fragment that reaches into the last segment (the user name) is replaced; `/Users/` alone names no one.
    const shortest = spelling.lastIndexOf('/') + 2
    for (let length = Math.min(spelling.length - 1, text.length); length >= shortest; length--) {
      const at = text.length - length
      if (text.endsWith(spelling.slice(0, length)) && (at === 0 || !PATH_CHAR.test(text[at - 1]!))) {
        return `${text.slice(0, at)}~`
      }
    }
  }
  return text
}

/** `text` cut to `max` UTF-16 units, never between the two halves of a surrogate pair. Callers go through `shown`. */
function clip(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) {
    return { text, cut: false }
  }
  const high = text.charCodeAt(max - 1)
  const end = high >= 0xd800 && high <= 0xdbff ? max - 1 : max
  return { text: text.slice(0, end), cut: true }
}

/**
 * Recorded `text` as a tool shows it: redacted, then cut to `max`. Redaction runs first because it matches the whole
 * home path or token; a cut inside one would leave its start behind unredacted.
 */
export function shown(
  text: string,
  max: number,
  redaction: Redaction,
  /** `true` for a field the kit cut before it was redacted (a title, a first prompt). */
  cutUpstream = false,
): { text: string; cut: boolean } {
  return clip(cutUpstream ? redaction.cutText(text) : redaction.text(text), max)
}

/** Epoch milliseconds as an ISO 8601 UTC string. */
export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Characters of `value` serialized as the MCP reply carries it. */
export function jsonChars(value: unknown): number {
  return JSON.stringify(value).length
}

/** Sets `key` only when `value` is defined, so an omitted field stays absent rather than `undefined`. */
export function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}

export interface Page<T> {
  items: T[]
  /** Offset of the first item not returned; `undefined` when the page reached the end. */
  nextOffset: number | undefined
}

/**
 * Items `offset` to `offset + limit` of `all`, rendered one at a time, cut short where the next item would take the
 * serialized result past `budget` characters (`base` is what the result holds besides the items). The first item is
 * always included: list items keep every string clipped, so one item is far below the budget.
 */
export function pageWithin<S, T>(
  all: readonly S[],
  window: { offset: number; limit: number },
  render: (item: S, index: number) => T,
  base: number,
  budget = RESULT_CHARS,
): Page<T> {
  const items: T[] = []
  // Two characters for the brackets, one for each comma between items.
  let used = base + 2
  const end = Math.min(all.length, window.offset + window.limit)
  for (let index = window.offset; index < end; index++) {
    const item = render(all[index]!, index)
    const size = jsonChars(item) + (items.length > 0 ? 1 : 0)
    if (items.length > 0 && used + size > budget) {
      return { items, nextOffset: index }
    }
    items.push(item)
    used += size
  }
  return { items, nextOffset: end < all.length ? end : undefined }
}
