import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { LoadedTrace, TraceStoreDeps } from '../src/trace-store.ts'
import { TraceStore } from '../src/trace-store.ts'

const encoder = new TextEncoder()

/** A home directory built from parts, so no literal home path sits in the repo. */
export const HOME = ['', 'home', 'u'].join('/')

export function present<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll(HOME, '~')) as T
}

/** Synthetic JSONL files in memory with size and mtime, and a loader that points each event at its line. */
export function fixture() {
  const files = new Map<string, Uint8Array>()
  const mtimes = new Map<string, number>()
  const reads: { file: string; start: number; end: number }[] = []
  let clock = 1
  const put = (file: string, text: string): void => {
    files.set(file, encoder.encode(text))
    mtimes.set(file, clock++)
  }
  const write = (file: string, records: unknown[]): void => {
    put(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  }
  const parse = (file: string): Trace => {
    const bytes = files.get(file)!
    const events: TraceEvent[] = []
    let offset = 0
    let line = 1
    for (const text of new TextDecoder().decode(bytes).split('\n')) {
      const length = encoder.encode(text).byteLength
      if (text) {
        const original = JSON.parse(text) as { id: string; kind: TraceEvent['kind']; text?: string }
        events.push({
          id: original.id,
          seq: events.length,
          ts: events.length,
          kind: original.kind,
          payload: original.text === undefined ? {} : { text: original.text },
          source: { file, offset, length, line },
          original,
        })
      }
      offset += length + 1
      line += 1
    }
    return {
      schema: 'agent-trace',
      host: { id: 'test' },
      session: { id: file },
      capabilities: ['requests'],
      agents: [{ id: 'main' }],
      events,
      skipped: [],
    }
  }
  const io: TraceStoreDeps['io'] = {
    async readBytes(file, range) {
      const bytes = files.get(file)
      if (!bytes) {
        throw new Error(`missing ${file}`)
      }
      if (!range) {
        return bytes
      }
      reads.push({ file, ...range })
      return bytes.slice(range.start, range.end)
    },
    async stat(file) {
      const bytes = files.get(file)
      return bytes ? { kind: 'file', size: bytes.byteLength, mtimeMs: mtimes.get(file) ?? 0 } : null
    },
  }
  return { files, reads, write, put, parse, io }
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

/** A store over the fixture. `gates` holds a load open until resolved; `signals` records each load's signal. */
export function storeOf(
  overrides: Partial<TraceStoreDeps> & { io: TraceStoreDeps['io']; parse: (file: string) => Trace },
) {
  const loads: string[] = []
  const signals = new Map<string, AbortSignal>()
  const gates = new Map<string, ReturnType<typeof deferred>>()
  const { parse, ...deps } = overrides
  const store = new TraceStore({
    resolve: ref => (ref.startsWith('missing') ? undefined : { key: ref, path: `/logs/${ref}.jsonl` }),
    async load(session, opts): Promise<LoadedTrace> {
      loads.push(session.key)
      signals.set(session.key, opts.signal)
      opts.onProgress(10)
      const gate = gates.get(session.key)
      if (gate) {
        await Promise.race([
          gate.promise,
          new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason))),
        ])
      }
      opts.onProgress(1e9)
      return { trace: parse(session.path as string), canonical: false }
    },
    ...deps,
  })
  return { store, loads, signals, gates }
}
