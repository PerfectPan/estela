import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { LoadedTrace, TraceStoreDeps } from '../src/trace-store.ts'
import { cloneDeepWith } from 'es-toolkit/object'
import * as z from 'zod/mini'
import { TraceStore } from '../src/trace-store.ts'

const encoder = new TextEncoder()

/** A home directory built from parts, so no literal home path sits in the repo. */
export const HOME = ['', 'home', 'u'].join('/')

export function present<T>(value: T): T {
  return cloneDeepWith(value, item => (typeof item === 'string' ? item.replaceAll(HOME, '~') : undefined))
}

/** The records the tests write: an id, one of the kinds the fixture maps, and optional text. */
const fixtureRecord = z.looseObject({ id: z.string(), kind: z.enum(['user', 'request']), text: z.optional(z.string()) })

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
        const original: unknown = JSON.parse(text)
        const record = z.parse(fixtureRecord, original)
        const at = {
          id: record.id,
          seq: events.length,
          ts: events.length,
          source: { file, offset, length, line },
          original,
        }
        const payload = record.text === undefined ? {} : { text: record.text }
        events.push(
          record.kind === 'user' ? { ...at, kind: record.kind, payload } : { ...at, kind: record.kind, payload },
        )
      }
      offset += length + 1
      line += 1
    }
    return {
      schema: 'agent-trace',
      agent: { id: 'test' },
      session: { id: file },
      capabilities: ['requests'],
      agents: [{ id: 'main' }],
      events,
      skipped: [],
    }
  }
  const fs: TraceStoreDeps['fs'] = {
    async *read(file, range) {
      const bytes = files.get(file)
      if (!bytes) {
        throw new Error(`missing ${file}`)
      }
      if (range) {
        reads.push({ file, start: range.start, end: range.end ?? bytes.byteLength })
        yield bytes.slice(range.start, range.end ?? bytes.byteLength)
        return
      }
      yield bytes
    },
    async stat(file) {
      const bytes = files.get(file)
      return bytes ? { kind: 'file', size: bytes.byteLength, mtimeMs: mtimes.get(file) ?? 0 } : undefined
    },
  }
  return { files, reads, write, put, parse, fs }
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
  overrides: Partial<TraceStoreDeps> & { fs: TraceStoreDeps['fs']; parse: (file: string) => Trace },
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
      return { trace: parse(typeof session.path === 'string' ? session.path : session.path.path), canonical: false }
    },
    ...deps,
  })
  return { store, loads, signals, gates }
}
