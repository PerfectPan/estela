import { isCanonicalTraceFile, readRange } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionAdapters } from '@rivus/agent-kit/sessions'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { isTrace } from '@rivus/agent-trace-schema'
import type { CatalogPlatform } from './catalog-rows.ts'
import { loadErrorMessage } from './read-failure.ts'
import { sessionTargetLabel } from './session-target.ts'
import { transcriptToTrace } from './transcript-trace.ts'
import { defaultAdapters, sessionProviders } from './session-adapters.ts'

export interface LoadSessionOptions {
  platform: CatalogPlatform
  /**
   * Extend or override the default session readers by agent id; omit to use the kit and managed capture readers.
   * A target without an agent still runs detection on built-ins that were not overridden.
   */
  adapters?: SessionAdapters
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

/**
 * One session load for the whole shell: canonical agent-trace JSON keeps its fast path
 * (`isCanonicalTraceFile` + `isTrace`, which checks each payload against its kind; originals
 * live in the file), and a file that fails it is read like any other. Everything else reads
 * through the kit and maps to the canonical `Trace`. The kit's expected failures throw with
 * the wording the shell showed before it: missing file (with the `path#id` label),
 * `No adapter accepted …`, `agent: file:line: unknown format generation`, and the
 * IO error's own message.
 */
export async function loadSession(target: SessionTarget, options: LoadSessionOptions): Promise<Trace> {
  const fs = options.platform.fs
  try {
    if (await isCanonicalTraceFile(target.path, fs)) {
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
  const loaded = await loadTranscript(options.platform, target, {
    providers: sessionProviders({ ...defaultAdapters(options.platform.env), ...options.adapters }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  })
  if (!loaded.ok) {
    throw new Error(loadErrorMessage(loaded.error, sessionTargetLabel(target)))
  }
  return transcriptToTrace(loaded.value)
}

/** The one session `build` and `mcp` work on: loaded once, with its original records. */
export function sessionLoader(target: SessionTarget, platform: CatalogPlatform): () => Promise<Trace> {
  let loaded: Promise<Trace> | undefined
  return () => {
    loaded ??= loadSession(target, { platform })
    return loaded
  }
}
