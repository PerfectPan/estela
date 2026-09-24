import type { Trace } from '@rivus/agent-trace-schema'
import type { HostAdapter, LoadOptions, SessionRef } from './host.ts'
import type { TraceIO } from './io.ts'
import { isTrace } from '@rivus/agent-trace-schema'
import { splitSessionRef } from './jsonl.ts'

export class UnsupportedTraceError extends Error {
  constructor(path: string, cause?: unknown) {
    super(`No adapter accepted ${path}`)
    this.name = 'UnsupportedTraceError'
    if (cause !== undefined)
      this.cause = cause
  }
}

export function sessionRef(ref: SessionRef | string): SessionRef {
  if (typeof ref === 'string') {
    const split = splitSessionRef(ref)
    return { host: '', path: split.file, sessionId: split.sessionId }
  }
  const split = splitSessionRef(ref.path)
  return {
    host: ref.host,
    path: split.file,
    sessionId: ref.sessionId ?? split.sessionId,
  }
}

function refLabel(ref: SessionRef | string): string {
  if (typeof ref === 'string')
    return ref
  return ref.sessionId ? `${ref.path}#${ref.sessionId}` : ref.path
}

/** Load a canonical JSON trace. Host adapters wrap this after they normalize. */
export async function loadCanonicalJson(path: string, io: TraceIO): Promise<Trace> {
  const text = await io.readText(path)
  const value: unknown = JSON.parse(text)
  if (!isTrace(value))
    throw new Error(`${path} is not an agent-trace document`)
  return value
}

async function canonicalTrace(file: string, size: number, io: TraceIO, opts: LoadOptions): Promise<Trace | undefined> {
  const head = new TextDecoder().decode(await io.readBytes(file, { start: 0, end: Math.min(size, 4096) }))
  if (!/"schema"\s*:\s*"agent-trace"/.test(head.slice(0, 2000)))
    return undefined
  const text = await io.readText(file)
  opts.onProgress?.(new TextEncoder().encode(text).byteLength)
  try {
    const value: unknown = JSON.parse(text)
    if (isTrace(value))
      return value
  }
  catch (error) {
    if (!(error instanceof SyntaxError))
      throw error
  }
  return undefined
}

export async function loadTrace(
  ref: SessionRef | string,
  hosts: readonly HostAdapter[],
  io: TraceIO,
  opts: LoadOptions = {},
): Promise<Trace> {
  const parsed = sessionRef(ref)
  const info = await io.stat(parsed.path)
  if (info == null)
    throw new Error(`${refLabel(ref)} does not exist`)
  opts.signal?.throwIfAborted()

  let canonicalError: unknown
  try {
    const canonical = await canonicalTrace(parsed.path, info.size, io, opts)
    if (canonical)
      return canonical
  }
  catch (error) {
    canonicalError = error
    if (hosts.length === 0)
      throw error
  }

  for (const adapter of hosts) {
    opts.signal?.throwIfAborted()
    const candidate: SessionRef = { ...parsed, host: adapter.id }
    if (await adapter.detect(candidate, io))
      return adapter.load(candidate, io, opts)
  }
  throw new UnsupportedTraceError(refLabel(ref), canonicalError)
}
