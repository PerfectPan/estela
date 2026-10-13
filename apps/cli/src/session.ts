import type { SessionRef } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { isCanonicalTraceFile } from '@rivus/agent-trace-kernel'
import { nodeIO } from '@rivus/agent-trace-runtime-node'
import type { SessionAdapters } from '@rivus/agent-kit/sessions'
import { builtinSessionAdapters } from '@rivus/agent-kit/sessions'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { isTrace } from '@rivus/agent-trace-schema'
import type { CatalogPlatform } from './catalog-rows.ts'
import { loadErrorMessage } from './read-failure.ts'
import { kitTargetOf, sessionRefLabel } from './session-ref.ts'
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
 * `No adapter accepted …`, the hosts' `agent: file:line: unknown format generation`, and the
 * IO error's own message.
 */
export async function loadSession(target: string | SessionRef, options: LoadSessionOptions): Promise<Trace> {
  const kitTarget = kitTargetOf(target)
  try {
    if (await isCanonicalTraceFile(kitTarget.path, nodeIO)) {
      const text = await nodeIO.readText(kitTarget.path)
      options.onProgress?.(new TextEncoder().encode(text).byteLength)
      const value: unknown = JSON.parse(text)
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
