import { isCanonicalTraceFile, readRange } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionAdapters, SessionRef } from '@rivus/agent-kit/sessions'
import { builtinSessionAdapters } from '@rivus/agent-kit/sessions'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { isTrace } from '@rivus/agent-trace-schema'
import type { CatalogPlatform } from './catalog-rows.ts'
import { loadErrorMessage } from './read-failure.ts'
import { sessionRefLabel, targetOfPath } from './session-ref.ts'
import { transcriptToTrace } from './transcript-trace.ts'

export interface LoadSessionOptions {
  platform: CatalogPlatform
  /** Defaults to `builtinSessionAdapters`. */
  adapters?: SessionAdapters
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

/**
 * One session load for the whole shell: canonical agent-trace JSON keeps its fast path
 * (`isCanonicalTraceFile` + `isTrace`; originals live in the file), everything else reads
 * through the kit and maps to the canonical `Trace`. The kit's expected failures throw with
 * the wording the shell showed before it: missing file (with the `path#id` label),
 * `No adapter accepted …`, `agent: file:line: unknown format generation`, and the
 * IO error's own message.
 */
export async function loadSession(target: string | SessionRef, options: LoadSessionOptions): Promise<Trace> {
  const kitTarget = typeof target === 'string' ? targetOfPath(target) : target
  const fs = options.platform.fs
  try {
    if (await isCanonicalTraceFile(kitTarget.path, fs)) {
      const bytes = await readRange(fs, kitTarget.path)
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
  const loaded = await loadTranscript(options.platform, kitTarget, {
    adapters: options.adapters ?? builtinSessionAdapters,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  })
  if (!loaded.ok) {
    throw new Error(loadErrorMessage(loaded.error, sessionRefLabel(kitTarget)))
  }
  return transcriptToTrace(loaded.value)
}

/** The one session `build` and `mcp` work on: loaded once, with its original records. */
export function sessionLoader(path: string, platform: CatalogPlatform): () => Promise<Trace> {
  let loaded: Promise<Trace> | undefined
  return () => {
    loaded ??= loadSession(path, { platform })
    return loaded
  }
}
