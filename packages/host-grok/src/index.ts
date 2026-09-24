import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { HostAdapter, SessionHead, TraceIO } from '@rivus/agent-trace-kernel'
import { TRACE_SCHEMA } from '@rivus/agent-trace-schema'
import {
  asNumber,
  asRecord,
  asString,
  dirnamePath,
  edgeLines,
  generationError,
  joinPath,
  readEdges,
  readJsonlRecords,
} from '@rivus/agent-trace-kernel'
import { chunkText, parseGrokRecords, type GrokSessionMeta } from './parse-session.ts'

const CAPABILITIES: Capability[] = [
  'requests',
  'usage',
  'durations',
  'thinking',
  'compaction',
  'compactionTokens',
  'subagents',
  'hooks',
  'systemPrompt',
  'toolSchemas',
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

function sessionDir(path: string): string {
  return path.endsWith('/updates.jsonl') || path.endsWith('updates.jsonl') ? dirnamePath(path) : path
}

function updatesPath(path: string): string {
  return path.endsWith('updates.jsonl') ? path : joinPath(path, 'updates.jsonl')
}

async function readOptional(io: TraceIO, path: string, onBytes: (bytes: number) => void): Promise<string | undefined> {
  if ((await io.stat(path))?.kind !== 'file')
    return undefined
  const text = await io.readText(path)
  onBytes(new TextEncoder().encode(text).byteLength)
  return text
}

async function loadMeta(io: TraceIO, dir: string, onBytes: (bytes: number) => void): Promise<GrokSessionMeta> {
  const summaryPath = joinPath(dir, 'summary.json')
  const summaryText = await readOptional(io, summaryPath, onBytes)
  const meta: GrokSessionMeta = {}
  if (summaryText !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(summaryText) as unknown
    }
    catch {
      throw new Error(`grok: ${summaryPath}:1: invalid JSON`)
    }
    const summary = asRecord(value) ?? {}
    const format = asNumber(summary.chat_format_version)
    if (format !== undefined && format !== 1)
      throw generationError('grok', summaryPath, 1)
    const info = asRecord(summary.info)
    meta.id = asString(info?.id) ?? asString(summary.id)
    meta.cwd = asString(info?.cwd)
    meta.title = asString(summary.generated_title) ?? asString(summary.session_summary)
    meta.startedAt = timeOf(summary.created_at)
    meta.endedAt = timeOf(summary.last_active_at)
  }
  const prompt = await readOptional(io, joinPath(dir, 'system_prompt.txt'), onBytes)
  if (prompt && prompt.length > 0)
    meta.systemPrompt = prompt
  const toolsText = await readOptional(io, joinPath(dir, 'tool_definitions.json'), onBytes)
  if (toolsText !== undefined) {
    try {
      meta.tools = JSON.parse(toolsText) as unknown
    }
    catch {
      throw new Error(`grok: ${joinPath(dir, 'tool_definitions.json')}:1: invalid JSON`)
    }
  }
  return meta
}

async function enrichAgents(io: TraceIO, dir: string, agents: Trace['agents'], onBytes: (bytes: number) => void): Promise<void> {
  const subDir = joinPath(dir, 'subagents')
  if ((await io.stat(subDir))?.kind !== 'dir')
    return
  for (const entry of await io.list(subDir)) {
    if (entry.kind !== 'dir')
      continue
    const text = await readOptional(io, joinPath(joinPath(subDir, entry.name), 'meta.json'), onBytes)
    if (!text)
      continue
    let value: unknown
    try {
      value = JSON.parse(text) as unknown
    }
    catch {
      continue
    }
    const meta = asRecord(value)
    const id = asString(meta?.subagent_id) ?? entry.name
    const title = asString(meta?.description)
    const existing = agents.find(agent => agent.id === id)
    if (existing) {
      if (!existing.title && title)
        existing.title = title
      continue
    }
    agents.push({ id, parentId: 'main', ...(title ? { title } : {}) })
  }
}

function previewLines(lines: string[]): { firstPrompt?: string, lastAt?: number, startedAt?: number } {
  const preview: { firstPrompt?: string, lastAt?: number, startedAt?: number } = {}
  for (const line of lines) {
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    }
    catch {
      continue
    }
    const rec = asRecord(value)
    const update = asRecord(asRecord(rec?.params)?.update)
    const ts = timeOf(rec?.timestamp)
    if (ts !== undefined) {
      if (preview.startedAt === undefined)
        preview.startedAt = ts
      preview.lastAt = ts
    }
    if (!preview.firstPrompt && update?.sessionUpdate === 'user_message_chunk') {
      const text = chunkText(update.content)
      if (text)
        preview.firstPrompt = text.slice(0, 500)
    }
  }
  return preview
}

async function* walkUpdates(io: TraceIO, dir: string, depth: number, signal?: AbortSignal): AsyncGenerator<string> {
  signal?.throwIfAborted()
  const entries = await io.list(dir)
  for (const entry of entries) {
    if (entry.name === 'subagents')
      continue
    const path = joinPath(dir, entry.name)
    if (entry.kind === 'file' && entry.name === 'updates.jsonl')
      yield path
    else if (entry.kind === 'dir' && depth < 8)
      yield* walkUpdates(io, path, depth + 1, signal)
  }
}

export const grokAdapter: HostAdapter = {
  id: 'grok',
  displayName: 'Grok',
  capabilities: CAPABILITIES,
  roots(env) {
    return [joinPath(env.homeDir, '.grok/sessions')]
  },
  async *discover(root, io, opts) {
    if ((await io.stat(root)) == null) {
      yield { ref: { host: 'grok', path: root }, error: `grok: ${root} does not exist` }
      return
    }
    let paths: string[]
    try {
      paths = []
      for await (const path of walkUpdates(io, root, 0, opts.signal))
        paths.push(path)
    }
    catch (error) {
      yield { ref: { host: 'grok', path: root }, error: error instanceof Error ? error.message : String(error) }
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
      const dir = dirnamePath(path)
      let title: string | undefined
      let cwd: string | undefined
      let sessionId: string | undefined
      let lastActive = preview.lastAt
      const summaryStat = await io.stat(joinPath(dir, 'summary.json'))
      if (summaryStat?.kind === 'file' && summaryStat.size <= 64 * 1024) {
        try {
          const summary = asRecord(JSON.parse(await io.readText(joinPath(dir, 'summary.json'))) as unknown)
          const info = asRecord(summary?.info)
          title = asString(summary?.generated_title) ?? asString(summary?.session_summary)
          cwd = asString(info?.cwd)
          sessionId = asString(info?.id)
          lastActive = timeOf(summary?.last_active_at) ?? lastActive
        }
        catch {
          // The head still lists the session. Load reports a summary parse error.
        }
      }
      const head: SessionHead = {
        ref: { host: 'grok', path, ...(sessionId ? { sessionId } : {}) },
        lastActiveAt: lastActive ?? edges.mtimeMs,
        sizeBytes: edges.size,
      }
      if (title)
        head.title = title
      else if (preview.firstPrompt)
        head.title = preview.firstPrompt.slice(0, 80)
      if (cwd)
        head.cwd = cwd
      if (preview.startedAt !== undefined)
        head.startedAt = preview.startedAt
      if (preview.firstPrompt)
        head.firstPrompt = preview.firstPrompt
      yield head
    }
  },
  async detect(ref, io) {
    const dir = sessionDir(ref.path)
    try {
      const summary = await io.stat(joinPath(dir, 'summary.json'))
      const updates = await io.stat(joinPath(dir, 'updates.jsonl'))
      return summary?.kind === 'file' && updates?.kind === 'file'
    }
    catch {
      return false
    }
  },
  async load(ref, io, opts): Promise<Trace> {
    let read = 0
    const onBytes = (bytes: number): void => {
      read += bytes
      opts.onProgress?.(read)
    }
    const dir = sessionDir(ref.path)
    const file = updatesPath(ref.path)
    const meta = await loadMeta(io, dir, onBytes)
    const records = await readJsonlRecords(file, io, 'grok', { signal: opts.signal, onBytes })
    const parsed = parseGrokRecords(records, { ...meta, id: meta.id ?? ref.sessionId })
    await enrichAgents(io, dir, parsed.agents, onBytes)
    return {
      schema: TRACE_SCHEMA,
      host: { id: 'grok', ...(parsed.version ? { version: parsed.version } : {}) },
      session: parsed.session,
      capabilities: [...CAPABILITIES],
      agents: parsed.agents,
      events: parsed.events,
      skipped: parsed.skipped,
    }
  },
}

export { parseGrokUpdates } from './parse-session.ts'
