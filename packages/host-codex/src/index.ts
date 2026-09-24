import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { HostAdapter, SessionHead, TraceIO } from '@rivus/agent-trace-kernel'
import { TRACE_SCHEMA } from '@rivus/agent-trace-schema'
import {
  asRecord,
  asString,
  basenamePath,
  edgeLines,
  joinPath,
  readEdges,
  readJsonlRecords,
} from '@rivus/agent-trace-kernel'
import { parseCodexRecords, type ParsedCodex } from './parse-session.ts'

const CAPABILITIES: Capability[] = [
  'requests',
  'usage',
  'durations',
  'thinking',
  'compaction',
  'subagents',
]

function timeOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms))
      return ms
  }
  return undefined
}

function textFrom(content: unknown): string | undefined {
  if (typeof content === 'string')
    return content
  if (!Array.isArray(content))
    return undefined
  for (const part of content) {
    const text = asString(asRecord(part)?.text)
    if (text)
      return text
  }
  return undefined
}

function previewLines(lines: string[]): {
  title?: string
  cwd?: string
  startedAt?: number
  lastAt?: number
  firstPrompt?: string
  sessionId?: string
} {
  const preview: {
    title?: string
    cwd?: string
    startedAt?: number
    lastAt?: number
    firstPrompt?: string
    sessionId?: string
  } = {}
  for (const line of lines) {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    }
    catch {
      continue
    }
    const rec = asRecord(value)
    if (!rec)
      continue
    const payload = asRecord(rec.payload)
    const ts = timeOf(rec.timestamp) ?? timeOf(payload?.timestamp)
    if (ts !== undefined) {
      if (preview.startedAt === undefined)
        preview.startedAt = ts
      preview.lastAt = ts
    }
    if (rec.type === 'session_meta') {
      preview.sessionId = asString(payload?.session_id) ?? asString(payload?.id) ?? preview.sessionId
      preview.cwd = asString(payload?.cwd) ?? preview.cwd
    }
    if (!preview.firstPrompt && rec.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') {
      const text = textFrom(payload.content)
      if (text)
        preview.firstPrompt = text.slice(0, 500)
    }
  }
  return preview
}

async function* walkRollouts(io: TraceIO, dir: string, depth: number, signal?: AbortSignal): AsyncGenerator<string> {
  signal?.throwIfAborted()
  const entries = await io.list(dir)
  for (const entry of entries) {
    const path = joinPath(dir, entry.name)
    if (entry.kind === 'file' && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl'))
      yield path
    else if (entry.kind === 'dir' && depth < 6)
      yield* walkRollouts(io, path, depth + 1, signal)
  }
}

export const codexAdapter: HostAdapter = {
  id: 'codex',
  displayName: 'Codex',
  capabilities: CAPABILITIES,
  roots(env) {
    return [joinPath(env.homeDir, '.codex/sessions')]
  },
  async *discover(root, io, opts) {
    if ((await io.stat(root)) == null) {
      yield { ref: { host: 'codex', path: root }, error: `codex: ${root} does not exist` }
      return
    }
    let paths: string[]
    try {
      paths = []
      for await (const path of walkRollouts(io, root, 0, opts.signal))
        paths.push(path)
    }
    catch (error) {
      yield { ref: { host: 'codex', path: root }, error: error instanceof Error ? error.message : String(error) }
      return
    }
    for (const path of paths) {
      opts.signal?.throwIfAborted()
      const edges = await readEdges(io, path, opts.signal)
      if (!edges)
        continue
      const lines = edgeLines(edges.head, 'head', edges.whole)
      if (!edges.whole)
        lines.push(...edgeLines(edges.tail, 'tail', false))
      const preview = previewLines(lines)
      const head: SessionHead = {
        ref: { host: 'codex', path, ...(preview.sessionId ? { sessionId: preview.sessionId } : {}) },
        lastActiveAt: preview.lastAt ?? edges.mtimeMs,
        sizeBytes: edges.size,
      }
      if (preview.title ?? preview.firstPrompt)
        head.title = (preview.title ?? preview.firstPrompt)!.slice(0, 80)
      if (preview.cwd)
        head.cwd = preview.cwd
      if (preview.startedAt !== undefined)
        head.startedAt = preview.startedAt
      if (preview.firstPrompt)
        head.firstPrompt = preview.firstPrompt
      yield head
    }
  },
  async detect(ref, io) {
    const name = basenamePath(ref.path)
    if (name.startsWith('rollout-') && name.endsWith('.jsonl'))
      return true
    try {
      const edges = await readEdges(io, ref.path)
      if (!edges)
        return false
      const head = edges.head.slice(0, 2000)
      return head.includes('"session_meta"')
    }
    catch {
      return false
    }
  },
  async load(ref, io, opts): Promise<Trace> {
    let read = 0
    const records = await readJsonlRecords(ref.path, io, 'codex', {
      signal: opts.signal,
      onBytes(bytes) {
        read += bytes
        opts.onProgress?.(read)
      },
    })
    const parsed = parseCodexRecords(records, { sessionId: ref.sessionId })
    if (!ref.sessionId && parsed.session.id === 'unknown') {
      const stem = basenamePath(ref.path).replace(/\.jsonl$/, '')
      parsed.session.id = stem || 'unknown'
    }
    return {
      schema: TRACE_SCHEMA,
      host: { id: 'codex', ...(parsed.version ? { version: parsed.version } : {}) },
      session: parsed.session,
      capabilities: [...CAPABILITIES],
      agents: parsed.agents,
      events: parsed.events,
      skipped: parsed.skipped,
    }
  },
}

export function parseCodexRows(rows: unknown[]): Trace {
  const records = rows.map((value, index) => {
    const text = JSON.stringify(value)
    return { file: 'rollout.jsonl', offset: 0, length: new TextEncoder().encode(text).byteLength, line: index + 1, value }
  })
  const parsed: ParsedCodex = parseCodexRecords(records)
  return {
    schema: TRACE_SCHEMA,
    host: { id: 'codex', ...(parsed.version ? { version: parsed.version } : {}) },
    session: parsed.session,
    capabilities: [...CAPABILITIES],
    agents: parsed.agents,
    events: parsed.events,
    skipped: parsed.skipped,
  }
}
