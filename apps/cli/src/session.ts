import type { SessionRef } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { UnsupportedTraceError, isCanonicalTraceFile, splitSessionRef } from '@rivus/agent-trace-kernel'
import { nodeIO } from '@rivus/agent-trace-runtime-node'
import type { SessionAdapters } from '@rivus/agent-kit/sessions'
import { builtinSessionAdapters } from '@rivus/agent-kit/sessions'
import type { LoadTranscriptError, SessionTarget } from '@rivus/agent-kit/transcript'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { isTrace } from '@rivus/agent-trace-schema'
import type { CatalogPlatform } from './catalog-rows.ts'
import { transcriptToTrace } from './transcript-trace.ts'

export interface LoadSessionOptions {
  platform: CatalogPlatform
  /** Defaults to `builtinSessionAdapters`. */
  adapters?: SessionAdapters
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

function targetOf(target: string | SessionRef): SessionTarget {
  if (typeof target === 'string') {
    const split = splitSessionRef(target)
    return { path: split.file, ...(split.sessionId ? { sessionId: split.sessionId } : {}) }
  }
  return {
    agent: target.host,
    path: target.path,
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
  }
}

function loadError(error: LoadTranscriptError, path: string): Error {
  switch (error._tag) {
    case 'SessionNotFound':
      return new Error(`${path} does not exist`)
    case 'NoAdapterAccepted':
      return new UnsupportedTraceError(path)
    case 'UnknownFormatGeneration':
      return new Error(`${error.agent}: ${error.file}:${error.line}: unknown format generation`)
    case 'ReadFailed':
      return new Error(error.message, { cause: error.cause })
    case 'CapabilityUnsupported':
      return new Error(`no session adapter for ${error.agent}`)
  }
}

/**
 * One session load for the whole shell: canonical agent-trace JSON keeps its fast path
 * (`isCanonicalTraceFile` + `isTrace`; originals live in the file), everything else reads
 * through the kit and maps to the canonical `Trace`. The kit's expected failures throw with
 * the wording the shell showed before it: missing file, `UnsupportedTraceError`, the hosts'
 * `agent: file:line: unknown format generation`, and the IO error's own message.
 */
export async function loadSession(target: string | SessionRef, options: LoadSessionOptions): Promise<Trace> {
  const kitTarget = targetOf(target)
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
    throw loadError(loaded.error, kitTarget.path)
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
