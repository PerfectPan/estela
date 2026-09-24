import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { DiscoverPreview, HostAdapter, ReadProgress, TraceIO } from '@rivus/agent-trace-kernel'
import {
  asRecord,
  asString,
  dirnamePath,
  discoverSessions,
  joinPath,
  readJsonlRecords,
  readProgress,
  readTextCounted,
  timeOf,
  toTrace,
  walkFiles,
} from '@rivus/agent-trace-kernel'
import { chunkText, isInjectedChunk, META_KEY, parseGrokRecords, summaryFields, type GrokSessionMeta } from './parse-session.ts'

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

function sessionDir(path: string): string {
  return path.endsWith('updates.jsonl') ? dirnamePath(path) : path
}

function updatesPath(path: string): string {
  return path.endsWith('updates.jsonl') ? path : joinPath(path, 'updates.jsonl')
}

async function readOptional(io: TraceIO, path: string, progress: ReadProgress): Promise<string | undefined> {
  if ((await io.stat(path))?.kind !== 'file')
    return undefined
  return readTextCounted(io, path, progress)
}

async function loadMeta(io: TraceIO, dir: string, progress: ReadProgress): Promise<GrokSessionMeta> {
  const summaryPath = joinPath(dir, 'summary.json')
  const summaryText = await readOptional(io, summaryPath, progress)
  let meta: GrokSessionMeta = {}
  if (summaryText !== undefined) {
    let value: unknown
    try {
      value = JSON.parse(summaryText) as unknown
    }
    catch {
      throw new Error(`grok: ${summaryPath}:1: invalid JSON`)
    }
    meta = summaryFields(value, summaryPath)
  }
  const prompt = await readOptional(io, joinPath(dir, 'system_prompt.txt'), progress)
  if (prompt && prompt.length > 0)
    meta.systemPrompt = prompt
  const toolsText = await readOptional(io, joinPath(dir, 'tool_definitions.json'), progress)
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

async function enrichAgents(io: TraceIO, dir: string, agents: Trace['agents'], progress: ReadProgress): Promise<void> {
  const subDir = joinPath(dir, 'subagents')
  if ((await io.stat(subDir))?.kind !== 'dir')
    return
  for (const entry of await io.list(subDir)) {
    if (entry.kind !== 'dir')
      continue
    const text = await readOptional(io, joinPath(joinPath(subDir, entry.name), 'meta.json'), progress)
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

/** The first prompt skips injected chunks, the same rule as turns. */
function previewRecords(records: Record<string, unknown>[]): DiscoverPreview {
  const preview: DiscoverPreview = {}
  for (const rec of records) {
    const update = asRecord(asRecord(rec.params)?.update)
    const ts = timeOf(rec.timestamp)
    if (ts !== undefined) {
      preview.startedAt ??= ts
      preview.lastAt = ts
    }
    if (!preview.firstPrompt && update?.sessionUpdate === 'user_message_chunk') {
      const text = chunkText(update.content)
      if (text && !isInjectedChunk(asRecord(update[META_KEY]), text))
        preview.firstPrompt = text.slice(0, 500)
    }
  }
  return preview
}

export const grokAdapter: HostAdapter = {
  id: 'grok',
  displayName: 'Grok',
  capabilities: CAPABILITIES,
  roots(env) {
    return [joinPath(env.homeDir, '.grok/sessions')]
  },
  discover(root, io, opts) {
    return discoverSessions('grok', root, io, {
      signal: opts.signal,
      ...(opts.onTotal ? { onTotal: opts.onTotal } : {}),
      files: (fileIo, dir, signal) => walkFiles(fileIo, dir, {
        match: name => name === 'updates.jsonl',
        skipDir: name => name === 'subagents',
        maxDepth: 8,
        signal,
      }),
      preview: previewRecords,
      decorate: async (path, head, fileIo) => {
        const summaryPath = joinPath(dirnamePath(path), 'summary.json')
        const summaryStat = await fileIo.stat(summaryPath)
        if (summaryStat?.kind !== 'file' || summaryStat.size > 64 * 1024)
          return
        try {
          const fields = summaryFields(JSON.parse(await fileIo.readText(summaryPath)) as unknown, summaryPath)
          if (fields.id)
            head.ref.sessionId = fields.id
          if (fields.title)
            head.title = fields.title
          if (fields.cwd)
            head.cwd = fields.cwd
          if (fields.endedAt !== undefined)
            head.lastActiveAt = fields.endedAt
        }
        catch {
          // The head still lists the session. Load reports a summary parse error.
        }
      },
    })
  },
  async detect(ref, io) {
    const dir = sessionDir(ref.path)
    try {
      const summary = await io.stat(joinPath(dir, 'summary.json'))
      const updates = await io.stat(updatesPath(ref.path))
      return summary?.kind === 'file' && updates?.kind === 'file'
    }
    catch {
      return false
    }
  },
  async load(ref, io, opts): Promise<Trace> {
    const progress = readProgress(opts.onProgress)
    const dir = sessionDir(ref.path)
    const file = updatesPath(ref.path)
    const meta = await loadMeta(io, dir, progress)
    const records = await readJsonlRecords(file, io, 'grok', { signal: opts.signal, progress })
    const parsed = parseGrokRecords(records, { ...meta, id: meta.id ?? ref.sessionId })
    await enrichAgents(io, dir, parsed.agents, progress)
    return toTrace('grok', CAPABILITIES, parsed)
  },
}
