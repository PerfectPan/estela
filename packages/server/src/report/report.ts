import type {
  EventDetail,
  ExportReportInput,
  ExportReportResult,
  ReportLocale,
  ReportSource,
  ReportTrace,
  TraceStore,
} from '@rivus/estela-rpc'
import { lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises'
import { join, parse, resolve } from 'node:path'
import process from 'node:process'
import { buildReport } from '@rivus/estela-rpc'
import { homeDir } from '@rivus/estela-runtime-node'
import type { DevframeDefinition } from 'devframe'
import { createBuild } from 'devframe/adapters/build'
import * as z from 'zod/mini'
import { homeRedaction, type HomeRedaction } from '../sessions/redaction.ts'
import { packForFile } from './report-site.ts'

/**
 * The report payload for `traceId`: the view from the store and the first events in full from `full`
 * (`build` passes the trace it loaded, so the file is read once; the export reads through the
 * store). Always redacted, whatever the server's `redacts` says: with `redact`, or with the process
 * home alone when the caller names none, as the CLI's `build` does.
 */
export async function reportOf(
  store: TraceStore,
  traceId: string,
  full: (ids: readonly string[]) => Promise<EventDetail[]>,
  locale?: ReportLocale,
  redact: HomeRedaction = homeRedaction(homeDir()),
): Promise<ReportTrace> {
  return buildReport({ view: await store.view(traceId), full, redact, locale })
}

/** One report at a time per server instance: its `report-trace` slot serves one build, and DevFrame replaces `outDir`. */
export interface ReportQueue {
  run: <T>(work: () => Promise<T>) => Promise<T>
}

export function createReportQueue(): ReportQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run(work) {
      const next = tail.then(work)
      tail = next.catch(() => {})
      return next
    },
  }
}

const REPORT_MARKER = '<script type="application/json" id="report-trace">'
const MAX_EXISTING_REPORT_BYTES = 128 * 1024 * 1024
const notFound = z.object({ code: z.literal('ENOENT') })

export interface ExportReportOptions {
  /** The directory each report's new directory goes in: a host's own, or the working directory when omitted. */
  dir?: string
  /** For the report and for what this function returns and throws; the process home alone when omitted. */
  redact?: HomeRedaction
}

/** Raised when `build --out-dir` targets a location or existing directory that must not be wiped. */
export class ReportOutDirError extends Error {
  readonly path: string

  constructor(path: string, detail: string) {
    super(detail)
    this.name = 'ReportOutDirError'
    this.path = path
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Ensures `build --out-dir` will not recursively delete arbitrary user data (`createBuild` calls
 * `fs.rm(outDir, { recursive: true })`). Allows a non-existent path, an empty directory, or a
 * directory whose sole entry is an earlier Estela report `index.html`, while always refusing `/`,
 * the working directory, the home directory, symlinks, and non-directories.
 */
export async function checkReportOutDir(rawOutDir: string, options?: { cwd?: string; home?: string }): Promise<string> {
  const outDir = resolve(rawOutDir)
  const cwd = resolve(options?.cwd ?? process.cwd())
  const home = resolve(options?.home ?? homeDir())
  if (outDir === parse(outDir).root) {
    throw new ReportOutDirError(outDir, 'refusing to write a report to the filesystem root')
  }
  if (outDir === cwd) {
    throw new ReportOutDirError(outDir, 'refusing to overwrite the working directory')
  }
  if (outDir === home) {
    throw new ReportOutDirError(outDir, 'refusing to overwrite the home directory')
  }

  let stat
  try {
    stat = await lstat(outDir)
  } catch (error) {
    if (z.safeParse(notFound, error).success) {
      return outDir
    }
    throw error
  }
  if (stat.isSymbolicLink()) {
    throw new ReportOutDirError(outDir, 'refusing to follow a symbolic link at --out-dir')
  }
  if (!stat.isDirectory()) {
    throw new ReportOutDirError(outDir, 'path exists and is not a directory')
  }

  const realOut = await canonicalPath(outDir)
  if (realOut === parse(realOut).root) {
    throw new ReportOutDirError(outDir, 'refusing to write a report to the filesystem root')
  }
  if (realOut === (await canonicalPath(cwd))) {
    throw new ReportOutDirError(outDir, 'refusing to overwrite the working directory')
  }
  if (realOut === (await canonicalPath(home))) {
    throw new ReportOutDirError(outDir, 'refusing to overwrite the home directory')
  }

  const entries = await readdir(outDir)
  if (entries.length === 0) {
    return outDir
  }
  if (entries.length === 1 && entries[0] === 'index.html') {
    const indexPath = join(outDir, 'index.html')
    const indexStat = await lstat(indexPath)
    if (!indexStat.isSymbolicLink() && indexStat.isFile() && indexStat.size <= MAX_EXISTING_REPORT_BYTES) {
      const html = await readFile(indexPath, 'utf8')
      if (html.includes(REPORT_MARKER)) {
        return outDir
      }
    }
  }
  throw new ReportOutDirError(outDir, 'directory is not empty and is not an earlier Estela report')
}

/** DevFrame's static build of `definition` with `reportSource` set to `report`, then `packForFile`. */
async function buildSite(
  definition: DevframeDefinition,
  reportSource: ReportSource,
  outDir: string,
  report: ReportTrace,
): Promise<void> {
  reportSource.set(async () => report)
  await createBuild(definition, { outDir })
  await packForFile(outDir)
}

export function writeReport(
  definition: DevframeDefinition,
  reportSource: ReportSource,
  queue: ReportQueue,
  outDir: string,
  report: ReportTrace,
): Promise<void> {
  return queue.run(async () => {
    const checked = await checkReportOutDir(outDir)
    await buildSite(definition, reportSource, checked, report)
  })
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function stamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

const fileExists = z.object({ code: z.literal('EEXIST') })

/** A new directory, created here so no other export (or process) can take the same name. */
async function reserveDir(base: string): Promise<string> {
  for (let n = 1; ; n++) {
    const dir = n === 1 ? base : `${base}-${n}`
    try {
      await mkdir(dir)
      return dir
    } catch (error) {
      if (!z.safeParse(fileExists, error).success) {
        throw error
      }
    }
  }
}

/**
 * The new directory one export writes to, under `dir`: `estela-report-<traceId>-<time>`, then `-2`, `-3`, …
 * A plain `mkdir` claims the name, so it fails on whatever exists already, and "Export report" never
 * writes into a directory that was there before. That is why it needs none of `checkReportOutDir`'s
 * rules: those keep `build --out-dir` from removing an existing directory, and the build here removes
 * only the directory this function just created.
 * @internal
 */
export async function reserveReportDir(dir: string, traceId: string, now: Date): Promise<string> {
  return reserveDir(resolve(dir, `estela-report-${traceId.replaceAll(/[^\w-]/g, '').slice(0, 8)}-${stamp(now)}`))
}

/**
 * The dev server's "Export report": a new `estela-report-<traceId>-<time>` directory under `options.dir`,
 * else in the working directory. The report, the returned path, and the error message that reaches
 * the browser are always redacted, whatever the server's `redacts` says.
 */
export async function exportReport(
  definition: DevframeDefinition,
  reportSource: ReportSource,
  queue: ReportQueue,
  store: TraceStore,
  input: ExportReportInput,
  options: ExportReportOptions = {},
  now = new Date(),
): Promise<ExportReportResult> {
  const redact = options.redact ?? homeRedaction(homeDir())
  try {
    const report = await store.withEvents(input.traceId, read =>
      reportOf(store, input.traceId, read, input.locale, redact),
    )
    const outDir = await queue.run(async () => {
      const dir = await reserveReportDir(options.dir ?? process.cwd(), input.traceId, now)
      await buildSite(definition, reportSource, dir, report)
      return dir
    })
    // Absolute, so the browser can say exactly where; the home directory shows as `~`.
    return {
      path: redact.text(join(outDir, 'index.html')),
      included: report.events.length,
      total: report.total,
    }
  } catch (error) {
    // No cause: it would carry the unredacted home path to the browser.
    throw new Error(redact.text(error instanceof Error ? error.message : String(error)))
  }
}
