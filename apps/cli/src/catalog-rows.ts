import type { HostAdapter, SessionHead, SessionRef, SessionSummary, TraceIO } from '@rivus/agent-trace-kernel'
import type { SessionError, SessionListRow } from '@rivus/agent-trace-rpc'
import type { IndexHead, IndexRow } from '@rivus/agent-trace-runtime-node'
import { fold, redactText, summaryOf } from '@rivus/agent-trace-kernel'
import { parseReadFailure } from './read-failure.ts'
import { projectName, sessionRefId } from './session-ref.ts'
import { userPrompts } from './user-prompts.ts'

/** Server-side row. `path` never leaves the server; the browser gets `ref`. */
export interface LiveRow {
  ref: string
  target: SessionRef
  size: number
  mtimeMs: number
  title?: string
  project?: string
  /** Shown with `~` for the home directory. */
  cwd?: string
  /** As recorded; kept in the index only. */
  rawCwd?: string
  startedAt?: number
  lastActiveAt: number
  sizeBytes: number
  firstPrompt?: string
  summary?: SessionSummary
  pending: boolean
  error?: SessionError
  /** Catalog revision of the last change, for `list-sessions({ since })`. */
  revision: number
}

export type DiscoverItem = SessionHead | { ref: SessionRef, error: string }

export function isDiscoverError(item: DiscoverItem): item is { ref: SessionRef, error: string } {
  return 'error' in item
}

/** Session text shown in the browser and the terminal: redacted like the workspace (D10) unless `AGENT_TRACE_REDACT=0`. */
export type Redactor = (text: string) => string

export function publicRow(row: LiveRow, redact: Redactor): SessionListRow {
  return {
    ref: row.ref,
    host: row.target.host,
    lastActiveAt: row.lastActiveAt,
    sizeBytes: row.sizeBytes,
    pending: row.pending,
    ...(row.title ? { title: redact(row.title) } : {}),
    ...(row.project ? { project: redact(row.project) } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
    ...(row.firstPrompt ? { firstPrompt: clipPrompt(redact(row.firstPrompt)) } : {}),
    ...summaryFields(row.summary),
    ...(row.error ? { error: row.error } : {}),
  }
}

/** The preview shows about nine lines; the whole prompt stays searchable in the index. */
const LIST_PROMPT_CHARS = 400

function clipPrompt(text: string): string {
  return text.length > LIST_PROMPT_CHARS ? `${text.slice(0, LIST_PROMPT_CHARS)}…` : text
}

function summaryFields(summary: SessionSummary | undefined): Omit<SessionListRow, 'ref' | 'host' | 'lastActiveAt' | 'sizeBytes' | 'pending'> {
  if (!summary)
    return {}
  const { contextShape, ...numbers } = summary
  if (!contextShape || contextShape.length === 0)
    return numbers
  const max = Math.max(...contextShape)
  return { ...numbers, shape: contextShape.map(value => max > 0 ? Math.round((value / max) * 100) : 0) }
}

/** One full read: `fold` of the loaded trace for the numbers, and the main agent's user prompts for search. */
export async function summarizeRow(
  adapter: HostAdapter,
  ref: SessionRef,
  io: TraceIO,
): Promise<{ summary: SessionSummary, prompts: string[] }> {
  const trace = await adapter.load(ref, io, {})
  return { summary: summaryOf(fold(trace)), prompts: userPrompts(trace) }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-09-24 14:02` in local time, for the terminal picker. */
export function activityLabel(ts: number): string {
  if (!ts)
    return ''
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type Head = Pick<SessionHead, 'title' | 'cwd' | 'startedAt' | 'firstPrompt'>

/** Fields shared by rows built from a `discover` head and from the index. */
function headFields(head: Head, homeDir: string): Partial<LiveRow> {
  const project = projectName(head.cwd)
  return {
    ...(head.title ? { title: head.title } : {}),
    ...(project ? { project } : {}),
    ...(head.cwd ? { cwd: redactText(head.cwd, homeDir), rawCwd: head.cwd } : {}),
    ...(head.startedAt !== undefined ? { startedAt: head.startedAt } : {}),
    ...(head.firstPrompt ? { firstPrompt: head.firstPrompt } : {}),
  }
}

/** A row from one `discover` head and the file's size and mtime (the cache key). */
export function rowFromHead(host: string, head: SessionHead, info: { size: number, mtimeMs: number }, homeDir: string): LiveRow {
  const target: SessionRef = { ...head.ref, host }
  return {
    ...headFields(head, homeDir),
    ref: sessionRefId(target),
    target,
    size: info.size,
    mtimeMs: info.mtimeMs,
    lastActiveAt: head.lastActiveAt,
    // The stat size, like a row from the index, so an unchanged file compares equal.
    sizeBytes: info.size,
    pending: true,
    revision: 0,
  }
}

/** A row stored by an earlier launch, shown until this launch's `discover` pass replaces it. */
export function rowFromIndex(stored: IndexRow, homeDir: string): LiveRow {
  return {
    ...headFields(stored, homeDir),
    ref: stored.ref,
    target: { host: stored.host, path: stored.path, ...(stored.sessionId ? { sessionId: stored.sessionId } : {}) },
    size: stored.size,
    mtimeMs: stored.mtimeMs,
    lastActiveAt: stored.lastActiveAt ?? stored.mtimeMs,
    sizeBytes: stored.size,
    ...(stored.summary ? { summary: stored.summary } : {}),
    pending: stored.summary === undefined,
    revision: 0,
  }
}

/** A "could not read" row (S4), placed at the file's mtime (or now when the file is gone). */
export function errorRow(target: SessionRef, message: string, homeDir: string, mtimeMs: number): LiveRow {
  return {
    ref: sessionRefId(target),
    target,
    size: 0,
    mtimeMs,
    lastActiveAt: mtimeMs,
    sizeBytes: 0,
    pending: false,
    error: parseReadFailure(message, homeDir, target.path),
    revision: 0,
  }
}

export function indexHeadOf(row: LiveRow): IndexHead {
  return {
    ref: row.ref,
    host: row.target.host,
    path: row.target.path,
    size: row.size,
    mtimeMs: row.mtimeMs,
    lastActiveAt: row.lastActiveAt,
    ...(row.target.sessionId ? { sessionId: row.target.sessionId } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(row.rawCwd ? { cwd: row.rawCwd } : {}),
    ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
    ...(row.firstPrompt ? { firstPrompt: row.firstPrompt } : {}),
  }
}

/** Same content for the browser; used to keep a row's revision when a re-read changed nothing. */
export function sameRow(a: LiveRow, b: LiveRow): boolean {
  const same = (text: string) => text
  return JSON.stringify(publicRow(a, same)) === JSON.stringify(publicRow(b, same))
}
