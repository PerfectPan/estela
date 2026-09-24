import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { HostAdapter, SessionHead, TraceIO } from '@rivus/agent-trace-kernel'
import { TRACE_SCHEMA } from '@rivus/agent-trace-schema'
import {
  asRecord,
  asString,
  basenamePath,
  dirnamePath,
  edgeLines,
  joinPath,
  readEdges,
  readJsonlRecords,
} from '@rivus/agent-trace-kernel'
import { parseClaudeRecords } from './parse-session.ts'

const CAPABILITIES: Capability[] = [
  'requests',
  'usage',
  'durations',
  'thinking',
  'compaction',
  'compactionTokens',
  'subagents',
  'hooks',
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

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string')
    return content
  if (!Array.isArray(content))
    return undefined
  const parts: string[] = []
  for (const block of content) {
    const text = asString(asRecord(block)?.text)
    if (text)
      parts.push(text)
  }
  return parts.length > 0 ? parts.join('') : undefined
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
    const ts = timeOf(rec.timestamp)
    if (ts !== undefined) {
      if (preview.startedAt === undefined)
        preview.startedAt = ts
      preview.lastAt = ts
    }
    if (!preview.sessionId)
      preview.sessionId = asString(rec.sessionId)
    if (!preview.cwd)
      preview.cwd = asString(rec.cwd)
    const aiTitle = asString(rec.aiTitle)
    if (aiTitle && !preview.title)
      preview.title = aiTitle
    if (!preview.firstPrompt && rec.type === 'user') {
      const text = textOf(asRecord(rec.message)?.content)
      if (text)
        preview.firstPrompt = text.slice(0, 500)
    }
  }
  return preview
}

async function* walkSessions(io: TraceIO, dir: string, depth: number, signal?: AbortSignal): AsyncGenerator<string> {
  signal?.throwIfAborted()
  const entries = await io.list(dir)
  for (const entry of entries) {
    if (entry.name === 'subagents')
      continue
    const path = joinPath(dir, entry.name)
    if (entry.kind === 'file' && entry.name.endsWith('.jsonl'))
      yield path
    else if (entry.kind === 'dir' && depth < 6)
      yield* walkSessions(io, path, depth + 1, signal)
  }
}

function agentFromFile(name: string, records: { value: unknown }[]): string {
  for (const record of records) {
    const id = asString(asRecord(record.value)?.agentId)
    if (id)
      return id
  }
  const base = name.replace(/\.jsonl$/, '')
  return base.startsWith('agent-') ? base.slice('agent-'.length) : base
}

export const claudeCodeAdapter: HostAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  capabilities: CAPABILITIES,
  roots(env) {
    return [joinPath(env.homeDir, '.claude/projects')]
  },
  async *discover(root, io, opts) {
    const rootStat = await io.stat(root)
    if (rootStat == null) {
      yield { ref: { host: 'claude-code', path: root }, error: `claude-code: ${root} does not exist` }
      return
    }
    let paths: string[]
    try {
      paths = []
      for await (const path of walkSessions(io, root, 0, opts.signal))
        paths.push(path)
    }
    catch (error) {
      yield {
        ref: { host: 'claude-code', path: root },
        error: error instanceof Error ? error.message : String(error),
      }
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
        ref: {
          host: 'claude-code',
          path,
          ...(preview.sessionId ? { sessionId: preview.sessionId } : {}),
        },
        lastActiveAt: preview.lastAt ?? edges.mtimeMs,
        sizeBytes: edges.size,
      }
      if (preview.title)
        head.title = preview.title
      else if (preview.firstPrompt)
        head.title = preview.firstPrompt.slice(0, 80)
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
    if (ref.path.includes('/.claude/projects/'))
      return true
    try {
      const edges = await readEdges(io, ref.path)
      if (!edges)
        return false
      const head = edges.head.slice(0, 4000)
      const user = head.includes('"type":"user"') || head.includes('"type": "user"')
      const assistant = head.includes('"type":"assistant"') || head.includes('"type": "assistant"')
      return (user || assistant) && head.includes('"sessionId"')
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
    const records = await readJsonlRecords(ref.path, io, 'claude-code', { signal: opts.signal, onBytes })
    const stem = basenamePath(ref.path).replace(/\.jsonl$/, '')
    const subDir = joinPath(joinPath(dirnamePath(ref.path), stem), 'subagents')
    const agentForFile = new Map<string, string>()
    if ((await io.stat(subDir))?.kind === 'dir') {
      for (const entry of await io.list(subDir)) {
        if (entry.kind !== 'file' || !entry.name.startsWith('agent') || !entry.name.endsWith('.jsonl'))
          continue
        const path = joinPath(subDir, entry.name)
        const extra = await readJsonlRecords(path, io, 'claude-code', { signal: opts.signal, onBytes })
        agentForFile.set(path, agentFromFile(entry.name, extra))
        records.push(...extra)
      }
    }
    const parsed = parseClaudeRecords(records, {
      sessionId: ref.sessionId,
      agentForFile: file => agentForFile.get(file),
    })
    if (parsed.session.id === 'unknown')
      parsed.session.id = stem || 'unknown'
    return {
      schema: TRACE_SCHEMA,
      host: { id: 'claude-code', ...(parsed.version ? { version: parsed.version } : {}) },
      session: parsed.session,
      capabilities: [...CAPABILITIES],
      agents: parsed.agents,
      events: parsed.events,
      skipped: parsed.skipped,
    }
  },
}
