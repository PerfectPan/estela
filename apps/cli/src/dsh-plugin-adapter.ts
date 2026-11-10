/** Reads the versioned capture format owned by our managed dsh plugin through the kit's session SPI. */
import { join } from 'node:path'
import * as z from 'zod/mini'
import { err, ok } from '@rivus/agent-kit/catalog'
import type { SessionAdapter, SessionHead, SessionPlatform } from '@rivus/agent-kit/sessions'
import type { Capability, SourcePointer, Transcript, TranscriptEvent } from '@rivus/agent-kit/transcript'
import { readRange } from '@rivus/agent-trace-kernel'
import { errorMessage } from './read-failure.ts'

type LoadOutcome = Awaited<ReturnType<SessionAdapter['load']>>
const AGENT_ID = 'dsh-plugin'
const CAPABILITIES: readonly Capability[] = ['requests', 'usage']
const missingFile = z.object({ code: z.literal('ENOENT') })
const tokenCount = z.number().check(z.gte(0))
const recordSchema = z.looseObject({
  v: z.literal(1),
  ts: z.iso.datetime({ offset: true }),
  type: z.string().check(z.minLength(1)),
  sessionId: z.optional(z.string().check(z.minLength(1))),
  cwd: z.optional(z.string()),
  model: z.optional(z.string()),
  eventType: z.optional(z.string()),
  usage: z.optional(
    z.looseObject({
      inputTokens: z.optional(tokenCount),
      outputTokens: z.optional(tokenCount),
      totalTokens: z.optional(tokenCount),
      cacheReadTokens: z.optional(tokenCount),
      cacheWriteTokens: z.optional(tokenCount),
      reasoningTokens: z.optional(tokenCount),
    }),
  ),
})
type DshTraceRecord = z.infer<typeof recordSchema>
const captureSchema = z.union([
  recordSchema,
  z.looseObject({ v: z.nonoptional(z.unknown()) }).check(z.refine(record => record.v !== 1)),
])

/** Known-union narrowing: the other schema branch explicitly excludes generation 1. */
function isSupported(record: z.infer<typeof captureSchema>): record is DshTraceRecord {
  return record.v === 1
}

interface CaptureLine {
  record: DshTraceRecord
  source: SourcePointer
}
interface ParsedCapture {
  lines: CaptureLine[]
  skipped: Transcript['skipped']
  unknownLine?: number
}

/** Keep physical byte ranges, including blank and CRLF lines, for the kit's readOriginal. */
function parseCapture(bytes: Uint8Array, path: string): ParsedCapture {
  const result: ParsedCapture = { lines: [], skipped: [] }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let start = 0
  let line = 1
  for (let at = 0; at <= bytes.length; at++) {
    if (at !== bytes.length && bytes[at] !== 10) {
      continue
    }
    const source = { file: path, offset: start, length: at - start, line }
    const slice = bytes.subarray(start, at)
    start = at + 1
    line += 1
    try {
      const text = decoder.decode(slice)
      if (!text.trim()) {
        continue
      }
      const input: unknown = JSON.parse(text)
      const parsed = z.safeParse(captureSchema, input)
      if (!parsed.success) {
        result.skipped.push({ source, reason: 'malformed-record' })
      } else if (!isSupported(parsed.data)) {
        result.unknownLine ??= source.line
      } else {
        if (parsed.data.type === 'session_start' && !parsed.data.sessionId) {
          result.skipped.push({ source, reason: 'malformed-record' })
          continue
        }
        result.lines.push({ record: parsed.data, source })
      }
    } catch {
      result.skipped.push({ source, reason: 'invalid-json' })
    }
  }
  return result
}

/** dsh counts uncached input separately; the kit's input count includes cache reads and writes. */
function usageOf(usage: NonNullable<DshTraceRecord['usage']>) {
  const { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } = usage
  return {
    ...(inputTokens === undefined
      ? {}
      : { inputTokens: inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

/** Metadata endpoints stay on disk; requests and lifecycle observations become canonical events. */
function eventOf({ record, source }: CaptureLine, seq: number): TranscriptEvent | undefined {
  const base = { id: `r:${source.line}`, seq, ts: Date.parse(record.ts), source, original: record }
  switch (record.type) {
    case 'session_start':
    case 'session_end':
      return undefined
    case 'assistant_message':
      return {
        ...base,
        kind: 'request',
        payload: {
          granularity: 'request',
          ...(record.model === undefined ? {} : { model: record.model }),
          ...(record.usage === undefined ? {} : { usage: usageOf(record.usage) }),
        },
      }
    default:
      return { ...base, kind: 'system', payload: { type: record.eventType ?? record.type } }
  }
}

function foldCapture(path: string, parsed: ParsedCapture): LoadOutcome {
  if (parsed.unknownLine !== undefined) {
    return err({ _tag: 'UnknownFormatGeneration', agent: AGENT_ID, file: path, line: parsed.unknownLine })
  }
  const first = parsed.lines.find(({ record }) => record.type === 'session_start')?.record
  if (!first?.sessionId) {
    return err({ _tag: 'ReadFailed', path, message: 'dsh capture has no valid session_start record' })
  }
  const events: TranscriptEvent[] = []
  let startedAt: number | undefined
  let endedAt: number | undefined
  for (const entry of parsed.lines) {
    const record = entry.record
    if (record.type === 'session_start' && record.sessionId !== first.sessionId) {
      return err({ _tag: 'ReadFailed', path, message: 'dsh capture contains multiple session ids' })
    }
    const ts = Date.parse(record.ts)
    startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts)
    endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts)
    const event = eventOf(entry, events.length)
    if (event) {
      events.push(event)
    }
  }
  return ok({
    agent: AGENT_ID,
    session: {
      id: first.sessionId,
      ...(first.cwd === undefined ? {} : { cwd: first.cwd }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
    },
    agents: [{ id: 'main' }],
    events,
    capabilities: [...CAPABILITIES],
    skipped: parsed.skipped,
  })
}

async function captureHead(platform: SessionPlatform, path: string, size: number): Promise<ParsedCapture> {
  return parseCapture(await readRange(platform.fs, path, { start: 0, end: Math.min(size, 64 * 1024) }), path)
}

/** Our capture format is independent of dsh's own persisted session generations. */
export const dshPluginSessionAdapter: SessionAdapter = {
  specificationVersion: 'sessions-v1',
  agent: AGENT_ID,
  displayName: 'DeepSeek Harness (plugin)',
  capabilities: CAPABILITIES,
  home: { envVar: 'DSH_HOME', defaultPath: ['.dsh'] },
  roots: home => [join(home.path, 'agent-trace')],
  async *discover(platform, root, options) {
    let entries
    try {
      entries = await platform.fs.list(root)
    } catch (error) {
      if (!z.safeParse(missingFile, error).success) {
        yield {
          ref: { agent: AGENT_ID, path: root },
          error: { _tag: 'ReadFailed', path: root, message: errorMessage(error) },
        }
      }
      return
    }
    const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.ndjson'))
    options?.onTotal?.(files.length)
    for (const entry of files) {
      options?.signal?.throwIfAborted()
      const path = join(root, entry.name)
      try {
        const info = await platform.fs.stat(path, { followSymlinks: true })
        if (info?.kind !== 'file') {
          continue
        }
        const head = await captureHead(platform, path, info.size)
        const first = head.lines.find(({ record }) => record.type === 'session_start')?.record
        yield {
          ref: { agent: AGENT_ID, path, ...(first?.sessionId === undefined ? {} : { sessionId: first.sessionId }) },
          lastActiveAt: info.mtimeMs,
          sizeBytes: info.size,
          ...(first?.cwd === undefined ? {} : { cwd: first.cwd }),
          ...(first?.sessionId === undefined ? {} : { title: first.sessionId }),
        } satisfies SessionHead
      } catch (error) {
        yield { ref: { agent: AGENT_ID, path }, error: { _tag: 'ReadFailed', path, message: errorMessage(error) } }
      }
    }
  },
  async detect(platform, ref) {
    if (!ref.path.endsWith('.ndjson')) {
      return false
    }
    try {
      const info = await platform.fs.stat(ref.path, { followSymlinks: true })
      if (info?.kind !== 'file') {
        return false
      }
      const head = await captureHead(platform, ref.path, info.size)
      return head.unknownLine !== undefined || head.lines.some(({ record }) => record.type === 'session_start')
    } catch {
      return false
    }
  },
  async load(platform, ref, options) {
    options?.signal?.throwIfAborted()
    try {
      const info = await platform.fs.stat(ref.path, { followSymlinks: true })
      if (info?.kind !== 'file') {
        return err({ _tag: 'SessionNotFound', path: ref.path })
      }
      const bytes = await readRange(platform.fs, ref.path, { start: 0, end: info.size })
      options?.signal?.throwIfAborted()
      options?.onProgress?.(bytes.byteLength)
      return foldCapture(ref.path, parseCapture(bytes, ref.path))
    } catch (error) {
      options?.signal?.throwIfAborted()
      return err({ _tag: 'ReadFailed', path: ref.path, message: errorMessage(error) })
    }
  },
}
