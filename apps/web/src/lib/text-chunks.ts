/** Characters drawn before "Show all": a 21 MB output in one `<pre>` blocks the page for seconds. */
export const TEXT_CAP = 256 * 1024

/** "Show all" appends the rest in blocks of this size, one per frame. */
export const TEXT_CHUNK = 256 * 1024

/** Splits text into the first block and the rest, in `chunk`-sized pieces. */
export function textChunks(text: string, cap = TEXT_CAP, chunk = TEXT_CHUNK): { head: string, rest: string[] } {
  if (text.length <= cap)
    return { head: text, rest: [] }
  const rest: string[] = []
  for (let at = cap; at < text.length; at += chunk)
    rest.push(text.slice(at, at + chunk))
  return { head: text.slice(0, cap), rest }
}
