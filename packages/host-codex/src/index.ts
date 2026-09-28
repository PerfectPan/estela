import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { DiscoverPreview, HostAdapter } from '@rivus/agent-trace-kernel'
import {
  asRecord,
  asString,
  basenamePath,
  discoverSessions,
  joinPath,
  readEdges,
  readJsonlRecords,
  readProgress,
  timeOf,
  toTrace,
  walkFiles,
} from '@rivus/agent-trace-kernel'
import { INJECTED_USER, textFrom } from './codex-items.ts'
import { parseCodexRecords } from './parse-session.ts'

const CAPABILITIES: Capability[] = [
  'requests',
  'usage',
  'durations',
  'thinking',
  'compaction',
  'subagents',
]

/** The first prompt skips injected user text, the same rule as turns. */
function previewRecords(records: Record<string, unknown>[]): DiscoverPreview {
  const preview: DiscoverPreview = {}
  for (const rec of records) {
    const payload = asRecord(rec.payload)
    const ts = timeOf(rec.timestamp) ?? timeOf(payload?.timestamp)
    if (ts !== undefined) {
      preview.startedAt ??= ts
      preview.lastAt = ts
    }
    if (rec.type === 'session_meta') {
      preview.sessionId ??= asString(payload?.id) ?? asString(payload?.session_id)
      preview.cwd ??= asString(payload?.cwd)
    }
    if (!preview.firstPrompt && rec.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') {
      const text = textFrom(payload.content)
      if (text && !INJECTED_USER.test(text))
        preview.firstPrompt = text.slice(0, 500)
    }
  }
  return preview
}

export const codexAdapter: HostAdapter = {
  id: 'codex',
  displayName: 'Codex',
  capabilities: CAPABILITIES,
  roots(env) {
    return [joinPath(env.homeDir, '.codex/sessions')]
  },
  discover(root, io, opts) {
    return discoverSessions('codex', root, io, {
      signal: opts.signal,
      ...(opts.onTotal ? { onTotal: opts.onTotal } : {}),
      files: (fileIo, dir, signal) => walkFiles(fileIo, dir, {
        match: name => name.startsWith('rollout-') && name.endsWith('.jsonl'),
        maxDepth: 6,
        signal,
      }),
      preview: previewRecords,
    })
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
    const progress = readProgress(opts.onProgress)
    const records = await readJsonlRecords(ref.path, io, 'codex', { signal: opts.signal, progress })
    const parsed = parseCodexRecords(records, { sessionId: ref.sessionId })
    if (!ref.sessionId && parsed.session.id === 'unknown') {
      const stem = basenamePath(ref.path).replace(/\.jsonl$/, '')
      parsed.session.id = stem || 'unknown'
    }
    return toTrace('codex', CAPABILITIES, parsed)
  },
}
