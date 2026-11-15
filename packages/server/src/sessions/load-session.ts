import { isCanonicalTraceFile, readRange } from '@rivus/estela-kernel'
import type { Trace } from '@rivus/estela-schema'
import type { Platform } from '@rivus/agent-kit/platform'
import type { SessionAdapters, SessionPlatform } from '@rivus/agent-kit/sessions'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { isTrace } from '@rivus/estela-schema'
import { hardenPlatform, MAX_CANONICAL_TRACE_BYTES } from './node-platform.ts'
import { loadErrorMessage } from './read-failure.ts'
import { sessionTargetLabel } from './session-target.ts'
import { transcriptToTrace } from './transcript-trace.ts'
import { sessionProviders } from './adapters.ts'

/** What the shell's kit calls take: reads plus the environment the agent homes resolve from. */
export type ShellPlatform = SessionPlatform & Pick<Platform, 'env' | 'home'>

export interface LoadSessionOptions {
  platform: ShellPlatform
  /**
   * Extend or override the kit's built-in session adapters by agent id; omit to use the built-ins.
   * A target without an agent still runs detection on built-ins that were not overridden.
   */
  adapters?: SessionAdapters
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

/**
 * One session load for the whole shell: canonical Estela JSON keeps its fast path
 * (`isCanonicalTraceFile` + `isTrace`, which checks each payload against its kind; originals
 * live in the file), and a file that fails it is read like any other. Everything else reads
 * through the kit and maps to the canonical `Trace`. The kit's expected failures throw with
 * the wording the shell showed before it: missing file (with the `path#id` label),
 * `No adapter accepted …`, `agent: file:line: unknown format generation`, and the
 * IO error's own message.
 */
export async function loadSession(target: SessionTarget, options: LoadSessionOptions): Promise<Trace> {
  const platform = hardenPlatform(options.platform)
  const fs = platform.fs
  try {
    if (await isCanonicalTraceFile(target.path, fs)) {
      const stat = await fs.stat(target.path, { followSymlinks: true })
      if (stat && stat.size > MAX_CANONICAL_TRACE_BYTES) {
        throw new Error(`${sessionTargetLabel(target)}: canonical trace file exceeds the 256 MB limit`)
      }
      const bytes = await readRange(fs, target.path)
      options.onProgress?.(bytes.byteLength)
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (isTrace(value)) {
        return value
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }
  }
  const loaded = await loadTranscript(platform, target, {
    ...(options.adapters ? { providers: sessionProviders(options.adapters) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  })
  if (!loaded.ok) {
    throw new Error(loadErrorMessage(loaded.error, sessionTargetLabel(target)))
  }
  return transcriptToTrace(loaded.value)
}
