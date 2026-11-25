import { priceRequestUsage, snapshotPricing, summaryOf } from '@rivus/estela-kernel'
import type { IndexCost, IndexHead, IndexRow, StoredSummary } from '@rivus/estela-runtime-node'
import type { ListSessionsQuery, SessionError, SessionListRow } from '@rivus/estela-rpc'
import type { SessionAdapters, SessionHead, SessionRef } from '@rivus/agent-kit/sessions'
import { PROMPT_CHARS, PROMPT_LIMIT } from '@rivus/estela-runtime-node'
import { summarizeSession } from '@rivus/agent-kit/transcript'
import type { ShellPlatform } from '../sessions/load-session.ts'
import { serverRedaction, type Redactor } from '../sessions/redaction.ts'
import { loadFailure } from '../sessions/read-failure.ts'
import { projectName, toKitPath, traceIdOf, sessionTargetLabel } from '../sessions/session-target.ts'
import { keepsSessionsInDatabase, sessionProviders } from '../sessions/adapters.ts'

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
  summary?: StoredSummary
  pending: boolean
  error?: SessionError
  /** Catalog revision of the last change, for `list-sessions({ since })`. */
  revision: number
}

/** The preview shows about nine lines; the whole prompt stays searchable in the index. */
const LIST_PROMPT_CHARS = 400

function clipPrompt(text: string): string {
  return text.length > LIST_PROMPT_CHARS ? `${text.slice(0, LIST_PROMPT_CHARS)}…` : text
}

function summaryFields(
  summary: StoredSummary | undefined,
): Omit<SessionListRow, 'traceId' | 'agent' | 'lastActiveAt' | 'sizeBytes' | 'pending'> {
  if (!summary) {
    return {}
  }
  const { contextShape, cost, ...numbers } = summary
  const priced = {
    ...numbers,
    ...(cost?.usd === undefined ? {} : { costUsd: cost.usd }),
    ...(cost?.unpriced === undefined ? {} : { unpricedRequests: cost.unpriced }),
  }
  if (!contextShape || contextShape.length === 0) {
    return priced
  }
  const max = Math.max(...contextShape)
  return { ...priced, shape: contextShape.map(value => (max > 0 ? Math.round((value / max) * 100) : 0)) }
}

/**
 * A cached summary when it was priced at the bundled price snapshot; one priced at another snapshot, or before
 * summaries carried a cost, is summarized again, since every cost shown names the snapshot that priced it.
 */
export function currentSummary(summary: StoredSummary | undefined): StoredSummary | undefined {
  return summary?.cost?.prices === snapshotPricing().version ? summary : undefined
}

/**
 * Whether a session recorded in `cwd` ran in `directory` or inside it. `directory` is absolute or starts with `~`,
 * which names each of `homes`: rows show the home the agent ran under and the server user's home alike as `~`.
 * A POSIX path is compared as recorded, case and all. Windows paths are compared with `/` for a backslash and
 * without case: discovery names a path with `/`, a user often writes a backslash, and the file system ignores case.
 */
export function withinDirectory(
  cwd: string | undefined,
  directory: string,
  homes: readonly string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  // An empty directory names none.
  if (!cwd || !directory) {
    return false
  }
  const fold = (path: string): string => {
    const kit = toKitPath(path, platform)
    return platform === 'win32' ? kit.toLowerCase() : kit
  }
  const withoutSlashes = (path: string): string => path.replace(/\/+$/, '')
  const asked = fold(directory)
  // `~` alone and `~/…` name a home; the rest after `~` is empty for the first.
  const rest = asked === '~' ? '' : /^~\/(.*)$/.exec(asked)?.[1]
  const roots = rest === undefined ? [asked] : homes.map(home => `${home}${rest === '' ? '' : `/${rest}`}`)
  const recorded = withoutSlashes(fold(cwd))
  return roots.some(path => {
    const root = withoutSlashes(fold(path))
    return recorded === root || recorded.startsWith(root === '' ? '/' : `${root}/`)
  })
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

/**
 * What a listing asks of the catalog: `ListSessionsQuery`, plus `cwd` to keep only the rows recorded in that
 * directory. The agent tools send it; the browser's `list-sessions` has no such input.
 */
export type SessionQuery = ListSessionsQuery & { cwd?: string }

/** The list cost of a session's request fields, by the rules the workspace prices its loaded requests with. */
function listCost(requestUsage: Parameters<typeof priceRequestUsage>[0] | undefined): IndexCost {
  const { pricing, version } = snapshotPricing()
  if (requestUsage === undefined) {
    return { prices: version }
  }
  const total = priceRequestUsage(requestUsage, pricing)
  return {
    prices: version,
    ...(total.usd === undefined ? {} : { usd: total.usd }),
    unpriced: total.requests - total.priced,
  }
}

export type SummarizeResult = { summary: StoredSummary; prompts: string[] } | { error: SessionError }

/**
 * One read per session: the kit's bounded summary pass (`adapter.summarize`, else the folded
 * load) produces the numbers and, under the same caps as the index, the main lane's user
 * prompts for search. `summaryOf` copies only the summary fields the wire contract and the
 * index know, so a kit-side addition cannot leak into rows unchecked.
 */
export async function summarizeRow(
  platform: ShellPlatform,
  adapters: SessionAdapters | undefined,
  target: SessionRef,
): Promise<SummarizeResult> {
  const result = await summarizeSession(platform, target, {
    ...(adapters ? { providers: sessionProviders(adapters) } : {}),
    prompts: { limit: PROMPT_LIMIT, maxChars: PROMPT_CHARS },
    requestUsage: true,
  })
  if (!result.ok) {
    return {
      error: loadFailure(result.error, serverRedaction(platform.home).text, sessionTargetLabel(target), target.path),
    }
  }
  return {
    summary: { ...summaryOf(result.value), cost: listCost(result.value.requestUsage) },
    prompts: (result.value.prompts ?? []).map(prompt => prompt.text),
  }
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
function headFields(head: Head, redact: Redactor): Partial<LiveRow> {
  const project = projectName(head.cwd)
  return {
    ...(head.title ? { title: head.title } : {}),
    ...(project ? { project } : {}),
    ...(head.cwd ? { cwd: redact(head.cwd), rawCwd: head.cwd } : {}),
    ...(head.startedAt !== undefined ? { startedAt: head.startedAt } : {}),
    ...(head.firstPrompt ? { firstPrompt: head.firstPrompt } : {}),
  }
}

/** A row from one `discover` head and the file's size and mtime (the cache key). */
export function rowFromHead(
  target: SessionRef,
  head: SessionHead,
  info: { size: number; mtimeMs: number },
  redact: Redactor,
  sharedFile = false,
  /** The cache key, when the file's own stamp says nothing about this one session (a shared database). */
  key: { size: number; mtimeMs: number } = info,
): LiveRow {
  return {
    ...headFields(head, redact),
    // A database session keeps its id even while it is the only row in that database.
    traceId: traceIdOf(
      sharedFile || keepsSessionsInDatabase(target.agent) ? target : { agent: target.agent, path: target.path },
    ),
    target,
    size: key.size,
    mtimeMs: key.mtimeMs,
    lastActiveAt: head.lastActiveAt,
    // The key's size, as a row from the index has it, so an unchanged session compares equal: the stat size, or 0
    // for a database row keyed by its own last write, where the shared file's size says nothing about this session.
    sizeBytes: key.size,
    pending: true,
    revision: 0,
  }
}

/** A row stored by an earlier launch, shown until this launch's `discover` pass replaces it. */
export function rowFromIndex(stored: IndexRow, redact: Redactor): LiveRow {
  return {
    ...headFields(stored, redact),
    traceId: stored.traceId,
    target: { agent: stored.agent, path: stored.path, ...(stored.sessionId ? { sessionId: stored.sessionId } : {}) },
    size: stored.size,
    mtimeMs: stored.mtimeMs,
    lastActiveAt: stored.lastActiveAt ?? stored.mtimeMs,
    sizeBytes: stored.size,
    ...(currentSummary(stored.summary) ? { summary: stored.summary } : {}),
    pending: currentSummary(stored.summary) === undefined,
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
