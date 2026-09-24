import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { DiscoverPreview, HostAdapter, ReadProgress, SourcedRecord, TraceIO } from '@rivus/agent-trace-kernel'
import {
  asRecord,
  asString,
  basenamePath,
  dirnamePath,
  discoverSessions,
  joinPath,
  mergeByTime,
  readEdges,
  readJsonlRecords,
  readProgress,
  readTextCounted,
  timeOf,
  toTrace,
  walkFiles,
} from '@rivus/agent-trace-kernel'
import { isPrompt, parseClaudeRecords, recordText, userFlags, type AgentMeta } from './parse-session.ts'

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

/** Title and first prompt use the same rule as turns: the first real user prompt. */
function previewRecords(records: Record<string, unknown>[]): DiscoverPreview {
  const preview: DiscoverPreview = {}
  for (const rec of records) {
    const ts = timeOf(rec.timestamp)
    if (ts !== undefined) {
      preview.startedAt ??= ts
      preview.lastAt = ts
    }
    preview.sessionId ??= asString(rec.sessionId)
    preview.cwd ??= asString(rec.cwd)
    preview.title ??= asString(rec.customTitle) ?? asString(rec.aiTitle)
    if (!preview.firstPrompt && rec.type === 'user' && rec.isSidechain !== true) {
      const content = asRecord(rec.message)?.content
      const text = recordText(content)
      if (text && isPrompt(userFlags(rec, content)))
        preview.firstPrompt = text.slice(0, 500)
    }
  }
  return preview
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
  discover(root, io, opts) {
    return discoverSessions('claude-code', root, io, {
      signal: opts.signal,
      ...(opts.onTotal ? { onTotal: opts.onTotal } : {}),
      files: (fileIo, dir, signal) => walkFiles(fileIo, dir, {
        match: name => name.endsWith('.jsonl'),
        skipDir: name => name === 'subagents',
        maxDepth: 6,
        signal,
      }),
      preview: previewRecords,
    })
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
    const progress = readProgress(opts.onProgress)
    const main = await readJsonlRecords(ref.path, io, 'claude-code', { signal: opts.signal, progress })
    const stem = basenamePath(ref.path).replace(/\.jsonl$/, '')
    const nested = await nestedSubagents(io, ref.path, stem, opts.signal, progress)
    const parsed = parseClaudeRecords(mergeByTime([main, ...nested.groups]), {
      sessionId: ref.sessionId,
      agentForFile: file => nested.agentForFile.get(file),
      agentMeta: nested.metas,
    })
    parsed.skipped.push(...nested.skipped)
    if (parsed.session.id === 'unknown')
      parsed.session.id = stem || 'unknown'
    return toTrace('claude-code', CAPABILITIES, parsed)
  },
}

/**
 * Walk `<id>/subagents/` recursively (workflows nest one level deeper).
 * `agent-*.jsonl` are transcripts; `agent-*.meta.json` gives a lane its title
 * and spawning tool call; any other file is one `skipped` entry.
 */
async function nestedSubagents(
  io: TraceIO,
  sessionPath: string,
  stem: string,
  signal: AbortSignal | undefined,
  progress: ReadProgress,
): Promise<{ groups: SourcedRecord[][], agentForFile: Map<string, string>, metas: Map<string, AgentMeta>, skipped: Trace['skipped'] }> {
  const out = { groups: [] as SourcedRecord[][], agentForFile: new Map<string, string>(), metas: new Map<string, AgentMeta>(), skipped: [] as Trace['skipped'] }
  const subDir = joinPath(joinPath(dirnamePath(sessionPath), stem), 'subagents')
  if ((await io.stat(subDir))?.kind !== 'dir')
    return out
  const files = await walkFiles(io, subDir, { match: () => true, maxDepth: 8, signal })
  const metaFiles = new Map<string, string>()
  for (const path of files) {
    const name = basenamePath(path)
    if (name.startsWith('agent') && name.endsWith('.meta.json')) {
      metaFiles.set(path.slice(0, -'.meta.json'.length), path)
      out.skipped.push({ file: path, line: 1, reason: 'agent-meta' })
      continue
    }
    if (!(name.startsWith('agent') && name.endsWith('.jsonl'))) {
      out.skipped.push({ file: path, line: 1, reason: 'journal' })
      continue
    }
    const records = await readJsonlRecords(path, io, 'claude-code', { signal, progress })
    const agentId = agentFromFile(name, records)
    out.agentForFile.set(path, agentId)
    out.groups.push(records)
  }
  for (const [path, agentId] of out.agentForFile) {
    const metaPath = metaFiles.get(path.slice(0, -'.jsonl'.length))
    if (metaPath)
      out.metas.set(agentId, await agentMeta(io, metaPath, progress))
  }
  return out
}

async function agentMeta(io: TraceIO, path: string, progress: ReadProgress): Promise<AgentMeta> {
  const text = await readTextCounted(io, path, progress)
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  }
  catch {
    throw new Error(`claude-code: ${path}:1: invalid JSON`)
  }
  const meta = asRecord(value)
  const out: AgentMeta = {}
  const title = asString(meta?.description)
  const toolUseId = asString(meta?.toolUseId)
  const parentAgentId = asString(meta?.parentAgentId)
  if (title)
    out.title = title
  if (toolUseId)
    out.toolUseId = toolUseId
  if (parentAgentId)
    out.parentAgentId = parentAgentId
  return out
}
