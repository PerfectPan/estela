/**
 * The read-side file system the trace-side code needs, shaped like the session platform's
 * `fs` (`@rivus/agent-kit`): the shell passes `createNodePlatform().fs`, tests pass an
 * in-memory stand-in. `stat` defaults to not following a symlink at `path`; callers that
 * compare a file against a stamp taken at load time pass `{ followSymlinks: true }`.
 */
export interface SessionFs {
  stat: (
    path: string,
    options?: { followSymlinks?: boolean },
  ) => Promise<{ kind: string; size: number; mtimeMs: number } | undefined>
  /** `range.end` is exclusive. */
  read: (path: string, range?: { start: number; end?: number }) => AsyncIterable<Uint8Array>
}

/** The whole range as one byte array. */
export async function readRange(
  fs: SessionFs,
  path: string,
  range?: { start: number; end?: number },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of fs.read(path, range)) {
    chunks.push(chunk)
    length += chunk.byteLength
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}
