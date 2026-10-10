import type { SessionRef, SessionSummary } from '@rivus/agent-trace-kernel'
import type { IndexHead, IndexRow } from '@rivus/agent-trace-runtime-node'
import type { SessionError, SessionListRow } from '@rivus/agent-trace-rpc'
import type { SessionAdapters, SessionHead, SessionPlatform } from '@rivus/agent-kit/sessions'
import type { Platform } from '@rivus/agent-kit/platform'
import { foldTranscript, loadTranscript } from '@rivus/agent-kit/transcript'
import { redactText } from '@rivus/agent-kit/redact'
import { loadFailure } from './read-failure.ts'
import { kitTargetOf, projectName, sessionRefId, sessionRefLabel } from './session-ref.ts'
import { userPrompts } from './user-prompts.ts'

/** What the catalog's kit calls take: reads plus the environment the homes resolve from. */
export type CatalogPlatform = SessionPlatform & Pick<Platform, 'env' | 'home'>

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

/** Session text shown in the browser and the terminal: redacted like the workspace (D10) unless `AGENT_TRACE_REDACT=0`. */
export type Redactor = (text: string) => string

/** The preview shows about nine lines; the whole prompt stays searchable in the index. */
const LIST_PROMPT_CHARS = 400

function clipPrompt(text: string): string {
  return text.length > LIST_PROMPT_CHARS ? `${text.slice(0, LIST_PROMPT_CHARS)}…` : text
}

function summaryFields(
  summary: SessionSummary | undefined,
): Omit<SessionListRow, 'ref' | 'host' | 'lastActiveAt' | 'sizeBytes' | 'pending'> {
  if (!summary) {
    return {}
  }
  const { contextShape, ...numbers } = summary
  if (!contextShape || contextShape.length === 0) {
    return numbers
  }
  const max = Math.max(...contextShape)
  return { ...numbers, shape: contextShape.map(value => (max > 0 ? Math.round((value / max) * 100) : 0)) }
}

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

export type SummarizeResult = { summary: SessionSummary; prompts: string[] } | { error: SessionError }

/**
 * Kit summary → the wire/index shape: same numbers, but the kit names the token totals
 * `inputTokens`/`outputTokens` where the `SessionListRow` contract and the session index
 * say `tokensIn`/`tokensOut` (the contract rename is PR 2b's). Undefined stays undefined.
 */
function summaryOf(summary: ReturnType<typeof foldTranscript>): SessionSummary {
  const out: SessionSummary = {}
  if (summary.turns !== undefined) {
    out.turns = summary.turns
  }
  if (summary.requests !== undefined) {
    out.requests = summary.requests
  }
  if (summary.inputTokens !== undefined) {
    out.tokensIn = summary.inputTokens
  }
  if (summary.outputTokens !== undefined) {
    out.tokensOut = summary.outputTokens
  }
  if (summary.durationMs !== undefined) {
    out.durationMs = summary.durationMs
  }
  if (summary.compactions !== undefined) {
    out.compactions = summary.compactions
  }
  if (summary.subagents !== undefined) {
    out.subagents = summary.subagents
  }
  if (summary.failedTools !== undefined) {
    out.failedTools = summary.failedTools
  }
  if (summary.contextShape !== undefined) {
    out.contextShape = summary.contextShape
  }
  return out
}

/**
 * One read per session: the transcript loads once through the kit, and both the summary
 * (`foldTranscript`, what `summarizeSession` runs) and the search prompts come from it. The
 * kit's bounded summary pass with prompts is tracked in PerfectPan/agent-kit#70.
 */
export async function summarizeRow(
  platform: CatalogPlatform,
  adapters: SessionAdapters,
  target: SessionRef,
): Promise<SummarizeResult> {
  const loaded = await loadTranscript(platform, kitTargetOf(target), { adapters })
  if (!loaded.ok) {
    return { error: loadFailure(loaded.error, platform.home, sessionRefLabel(target), target.path) }
  }
  return { summary: summaryOf(foldTranscript(loaded.value)), prompts: userPrompts(loaded.value) }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-09-24 14:02` in local time, for the terminal picker. */
export function activityLabel(ts: number): string {
  if (!ts) {
    return ''
  }
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
    ...(head.cwd ? { cwd: redactText(head.cwd, { home: homeDir }), rawCwd: head.cwd } : {}),
    ...(head.startedAt !== undefined ? { startedAt: head.startedAt } : {}),
    ...(head.firstPrompt ? { firstPrompt: head.firstPrompt } : {}),
  }
}

/** A row from one `discover` head and the file's size and mtime (the cache key). */
export function rowFromHead(
  target: SessionRef,
  head: SessionHead,
  info: { size: number; mtimeMs: number },
  homeDir: string,
  sharedFile = false,
): LiveRow {
  return {
    ...headFields(head, homeDir),
    // The session id is part of the ref only when several sessions share one file.
    ref: sessionRefId(sharedFile ? target : { host: target.host, path: target.path }),
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
export function errorRow(target: SessionRef, error: SessionError, mtimeMs: number): LiveRow {
  return {
    ref: sessionRefId({ host: target.host, path: target.path }),
    target,
    size: 0,
    mtimeMs,
    lastActiveAt: mtimeMs,
    sizeBytes: 0,
    pending: false,
    error,
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

const same = (text: string): string => text

/** Same content for the browser; used to keep a row's revision when a re-read changed nothing. */
export function sameRow(a: LiveRow, b: LiveRow): boolean {
  return JSON.stringify(publicRow(a, same)) === JSON.stringify(publicRow(b, same))
}
