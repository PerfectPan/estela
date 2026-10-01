/** Characters drawn before "Show all": a 21 MB output in one `<pre>` blocks the page for seconds. */
export const TEXT_CAP = 256 * 1024

/** "Show all" appends the rest in blocks of about this size, one per frame. */
export const TEXT_CHUNK = 256 * 1024

/** How far past the target a block may run to reach a newline before it is cut anyway. */
const LINE_SLACK = 16 * 1024

/**
 * Where a block that should end near `at` ends: after the next newline within `LINE_SLACK`,
 * else at `at` itself, moved back one unit if that would split a surrogate pair.
 */
export function cutAt(text: string, at: number): number {
  if (at >= text.length) {
    return text.length
  }
  const newline = text.indexOf('\n', at)
  if (newline >= 0 && newline - at <= LINE_SLACK) {
    return newline + 1
  }
  const code = text.charCodeAt(at - 1)
  return code >= 0xd800 && code <= 0xdbff ? at - 1 : at
}

/** The first block and the rest, cut at line ends (never inside a surrogate pair). */
export function textChunks(text: string, cap = TEXT_CAP, chunk = TEXT_CHUNK): { head: string; rest: string[] } {
  if (text.length <= cap) {
    return { head: text, rest: [] }
  }
  const headEnd = cutAt(text, cap)
  const rest: string[] = []
  for (let at = headEnd; at < text.length;) {
    const end = cutAt(text, at + chunk)
    rest.push(text.slice(at, end))
    at = end
  }
  return { head: text.slice(0, headEnd), rest }
}

/**
 * Size shown on "Show all": the UTF-8 length estimated from the UTF-16 length (exact for
 * ASCII, low for other text), so the label does not copy the whole text to measure it.
 */
export function estimateBytes(text: string): number {
  return text.length
}
