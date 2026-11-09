/**
 * The session adapter for the traces the managed dsh plugin records (see `./dsh-plugin.ts`). One
 * `.ndjson` file per session under `<dsh home>/agent-trace/`, one JSON record per line: lifecycle
 * events as dsh emits them. This adapter folds them into a transcript: each `assistant_message`
 * becomes one request per model call (dsh logs usage per message), the lifecycle markers become
 * `system` events, and record types the adapter does not know yet become `system` events carrying
 * the recorded type, so a trace a newer plugin wrote still loads.
 *
 * No `summarize` of its own: the catalog folds this transcript like any other adapter without a
 * pass, and the files are the plugin's per-event appends, never a whole-session log.
 */

import { join } from 'node:path'
import { err, ok } from '@rivus/agent-kit/catalog'
import type { SessionAdapter, SessionHead, SessionPlatform } from '@rivus/agent-kit/sessions'
import type { Capability, Transcript, TranscriptEvent, TranscriptEventPayloads } from '@rivus/agent-kit/transcript'

/** The load result's error union, taken from the interface: the sessions surface does not re-export it. */
type LoadOutcome = Awaited<ReturnType<SessionAdapter['load']>>

const AGENT_ID = 'dsh-plugin'
const DISPLAY_NAME = 'DeepSeek Harness (plugin)'

const CAPABILITIES: readonly Capability[] = ['requests', 'usage']

/** The adapter's home: the dsh home, with the traces in its `agent-trace` subdirectory. */
const HOME_RULE = { envVar: 'DSH_HOME', defaultPath: ['.dsh'] } as const

/** One record the plugin appended. Unknown fields stay unknown: the adapter reads what it knows. */
interface DshTraceRecord {
  ts?: string
  type?: string
  sessionId?: string
  cwd?: string
  model?: string
  eventType?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** Every non-blank line as a JSON record, or `undefined` for a line that is not one. */
function parseLines(text: string): { records: (DshTraceRecord | undefined)[]; bad: number } {
  const records: (DshTraceRecord | undefined)[] = []
  let bad = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    try {
      records.push(JSON.parse(trimmed) as DshTraceRecord)
    } catch {
      records.push(undefined)
      bad += 1
    }
  }
  return { records, bad }
}

function timeOf(text: string | undefined): number | undefined {
  if (text === undefined) {
    return undefined
  }
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? undefined : ms
}

/** The usage numbers the transcript schema knows, defaulting the ones the record omits. */
function definedUsage(usage: NonNullable<DshTraceRecord['usage']>): { inputTokens: number; outputTokens: number } {
  return { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }
}

/** The events one record becomes: its request, or a lifecycle marker under `system`. */
function eventsOf(record: DshTraceRecord, ts: number, id: string, path: string, line: number): TranscriptEvent[] {
  const source = { file: path, offset: 0, length: 1, line }
  const base = <K extends TranscriptEvent['kind']>(kind: K, payload: TranscriptEventPayloads[K]): TranscriptEvent =>
    ({
      id,
      seq: 0,
      ts,
      kind,
      payload,
      source,
    }) as TranscriptEvent
  switch (record.type) {
    case 'assistant_message': {
      const usage = record.usage
      return [
        base('request', {
          granularity: 'request',
          ...(record.model === undefined ? {} : { model: record.model }),
          ...(usage === undefined ? {} : { usage: definedUsage(usage) }),
        }),
      ]
    }
    case 'turn_started':
    case 'turn_ended':
    case 'tool_result':
      return [base('system', { type: record.type })]
    case 'session_start':
    case 'session_end':
      // Session metadata only; the endpoints carry no event.
      return []
    default:
      if (record.eventType !== undefined) {
        return [base('system', { type: record.eventType })]
      }
      return [base('system', { type: record.type ?? 'unknown' })]
  }
}

/** Folds the records of one trace file into the transcript the load path returns. */
function foldRecords(path: string, lines: { records: (DshTraceRecord | undefined)[] }): Transcript {
  const events: TranscriptEvent[] = []
  const skipped: Transcript['skipped'][number][] = []
  let startedAt: number | undefined
  let endedAt: number | undefined
  let sessionId: string | undefined
  let cwd: string | undefined
  let serial = 0
  let line = 0
  for (const record of lines.records) {
    line += 1
    if (record === undefined || typeof record !== 'object') {
      skipped.push({ reason: 'invalid-json', source: { file: path, offset: 0, length: 1, line } })
      continue
    }
    const ts = timeOf(record.ts)
    if (ts !== undefined) {
      startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts)
      endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts)
    }
    if (record.type === 'session_start') {
      sessionId = record.sessionId
      cwd = record.cwd
    }
    const at = ts ?? endedAt ?? 0
    events.push(...eventsOf(record, at, `r:${serial++}`, path, line))
  }
  events.forEach((event, index) => {
    event.seq = index
  })
  return {
    agent: AGENT_ID,
    session: {
      id: sessionId ?? 'unknown',
      ...(cwd === undefined ? {} : { cwd }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
    },
    agents: [{ id: 'main' }],
    events: [...events],
    capabilities: [...CAPABILITIES],
    skipped,
  }
}

/** Whether `path` is one of the plugin's trace files: an `.ndjson` under an `agent-trace` directory. */
function isTraceFile(path: string): boolean {
  return path.endsWith('.ndjson') && path.includes('/agent-trace/')
}

/** The whole file as UTF-8 text, through the platform's reads. */
async function readAllText(platform: SessionPlatform, path: string, end: number): Promise<string> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of platform.fs.read(path, { start: 0, end })) {
    chunks.push(chunk)
    total += chunk.length
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return new TextDecoder().decode(bytes)
}

function readFailed(path: string, message: string): LoadOutcome {
  return err({ _tag: 'ReadFailed', path, message }) as LoadOutcome
}

export const dshPluginSessionAdapter: SessionAdapter = {
  specificationVersion: 'sessions-v1',
  agent: AGENT_ID,
  displayName: DISPLAY_NAME,
  capabilities: CAPABILITIES,
  home: HOME_RULE,
  roots(home) {
    return [join(home.path, 'agent-trace')]
  },
  async *discover(platform, root) {
    let entries
    try {
      entries = await platform.fs.list(root)
    } catch {
      // A home without the plugin's directory lists nothing; the caller reports zero sessions.
      return
    }
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.ndjson')) {
        continue
      }
      const path = join(root, entry.name)
      const info = await platform.fs.stat(path, { followSymlinks: true })
      if (info?.kind !== 'file') {
        continue
      }
      const head = await readAllText(platform, path, Math.min(info.size, 64 * 1024))
      const first = parseLines(head).records.find(record => record?.type === 'session_start')
      yield {
        ref: {
          agent: AGENT_ID,
          path,
          ...(first?.sessionId === undefined ? {} : { sessionId: first.sessionId }),
        },
        lastActiveAt: info.mtimeMs,
        sizeBytes: info.size,
        ...(first?.cwd === undefined ? {} : { cwd: first.cwd }),
        ...(first?.sessionId === undefined ? {} : { title: first.sessionId }),
      } satisfies SessionHead
    }
  },
  async detect(_platform, ref) {
    return isTraceFile(ref.path)
  },
  async load(platform, ref) {
    let info
    try {
      info = await platform.fs.stat(ref.path, { followSymlinks: true })
      if (info?.kind !== 'file') {
        return readFailed(ref.path, 'the trace file is gone')
      }
    } catch (error) {
      return readFailed(ref.path, error instanceof Error ? error.message : String(error))
    }
    let text: string
    try {
      text = await readAllText(platform, ref.path, info.size)
    } catch (error) {
      return readFailed(ref.path, error instanceof Error ? error.message : String(error))
    }
    return ok(foldRecords(ref.path, parseLines(text)))
  },
}
