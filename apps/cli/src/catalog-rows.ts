import { summaryOf } from '@rivus/agent-trace-kernel'
import type { IndexHead, IndexRow } from '@rivus/agent-trace-runtime-node'
import type { SessionError, SessionListRow } from '@rivus/agent-trace-rpc'
import type { SessionAdapters, SessionHead, SessionPlatform, SessionRef } from '@rivus/agent-kit/sessions'
import type { Platform } from '@rivus/agent-kit/platform'
import type { SessionSummary } from '@rivus/agent-kit/transcript'
import { PROMPT_CHARS, PROMPT_LIMIT } from '@rivus/agent-trace-runtime-node'
import { summarizeSession } from '@rivus/agent-kit/transcript'
import { redactText } from '@rivus/agent-kit/redact'
import { loadFailure } from './read-failure.ts'
import { projectName, traceIdOf, sessionTargetLabel } from './session-target.ts'
import { builtinAdapters, sessionProviders } from './session-adapters.ts'

/** What the catalog's kit calls take: reads plus the environment the homes resolve from. */
export type CatalogPlatform = SessionPlatform & Pick<Platform, 'env' | 'home'>

/** Server-side row. `path` never leaves the server; the browser gets `traceId`. */
export interface LiveRow {
  traceId: string
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

/** Session text shown in the browser and the terminal: redacted like the workspace unless `AGENT_TRACE_REDACT=0`. */
export type Redactor = (text: string) => string

/** The preview shows about nine lines; the whole prompt stays searchable in the index. */
const LIST_PROMPT_CHARS = 400

function clipPrompt(text: string): string {
  return text.length > LIST_PROMPT_CHARS ? `${text.slice(0, LIST_PROMPT_CHARS)}…` : text
}

function summaryFields(
  summary: SessionSummary | undefined,
): Omit<SessionListRow, 'traceId' | 'agent' | 'lastActiveAt' | 'sizeBytes' | 'pending'> {
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
    traceId: row.traceId,
    agent: row.target.agent,
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
 * One read per session: the kit's bounded summary pass (`adapter.summarize`, else the folded
 * load) produces the numbers and, under the same caps as the index, the main lane's user
 * prompts for search. `summaryOf` copies only the summary fields the wire contract and the
 * index know, so a kit-side addition cannot leak into rows unchecked.
 */
export async function summarizeRow(
  platform: CatalogPlatform,
  adapters: SessionAdapters | undefined,
  target: SessionRef,
): Promise<SummarizeResult> {
  const result = await summarizeSession(platform, target, {
    providers: sessionProviders(adapters ?? builtinAdapters),
    prompts: { limit: PROMPT_LIMIT, maxChars: PROMPT_CHARS },
  })
  if (!result.ok) {
    return { error: loadFailure(result.error, platform.home, sessionTargetLabel(target), target.path) }
  }
  return { summary: summaryOf(result.value), prompts: (result.value.prompts ?? []).map(prompt => prompt.text) }
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
    // A database session keeps its id even while it is the only row in that database.
    traceId: traceIdOf(sharedFile || target.agent === 'opencode' ? target : { agent: target.agent, path: target.path }),
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
    traceId: stored.traceId,
    target: { agent: stored.agent, path: stored.path, ...(stored.sessionId ? { sessionId: stored.sessionId } : {}) },
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
    traceId: traceIdOf({ agent: target.agent, path: target.path }),
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
    traceId: row.traceId,
    agent: row.target.agent,
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
