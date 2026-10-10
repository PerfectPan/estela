import { splitSessionRef } from './jsonl.ts'
import { readRange, type SessionFs } from './fs.ts'

/**
 * True when `path` starts like a canonical agent-trace JSON file. Its events' originals
 * live in the file, not at their source pointers. The kit has no notion of this schema
 * head, so the check stays in trace and runs before the kit's detection.
 */
export async function isCanonicalTraceFile(path: string, fs: SessionFs): Promise<boolean> {
  const file = splitSessionRef(path).file
  const info = await fs.stat(file, { followSymlinks: true })
  if (!info || info.kind !== 'file') {
    return false
  }
  const head = new TextDecoder().decode(await readRange(fs, file, { start: 0, end: Math.min(info.size, 4096) }))
  return /"schema"\s*:\s*"agent-trace"/.test(head.slice(0, 2000))
}
