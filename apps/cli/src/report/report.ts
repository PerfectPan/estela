import type {
  EventDetail,
  ExportReportInput,
  ExportReportResult,
  ReportLocale,
  ReportTrace,
  TraceStore,
} from '@rivus/agent-trace-rpc'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { redact, redactText } from '@rivus/agent-kit/redact'
import { bindReportSource, buildReport } from '@rivus/agent-trace-rpc'
import { homeDir } from '@rivus/agent-trace-runtime-node'
import { createBuild } from 'devframe/adapters/build'
import * as z from 'zod/mini'
import devframe from '../server/devframe.ts'
import { packForFile } from './report-site.ts'

/**
 * The report payload for `traceId`: the view from the store and the first events in full from `full`
 * (`build` passes the trace it loaded, so the file is read once; the export reads through the
 * store). Always redacted, whatever `AGENT_TRACE_REDACT` says.
 */
export async function reportOf(
  store: TraceStore,
  traceId: string,
  full: (ids: readonly string[]) => Promise<EventDetail[]>,
  locale?: ReportLocale,
): Promise<ReportTrace> {
  const home = homeDir()
  return buildReport({ view: await store.view(traceId), full, redact: value => redact(value, { home }), locale })
}

let queue: Promise<unknown> = Promise.resolve()

/** One report at a time: the `report-trace` binding is module state, and DevFrame's build replaces `outDir`. */
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run)
  queue = next.catch(() => {})
  return next
}

/** DevFrame's static build with `report-trace` bound to `report`, then `packForFile`. */
async function buildSite(outDir: string, report: ReportTrace): Promise<void> {
  bindReportSource(async () => report)
  await createBuild(devframe, { outDir })
  await packForFile(outDir)
}

export function writeReport(outDir: string, report: ReportTrace): Promise<void> {
  return serialized(() => buildSite(outDir, report))
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
 * The dev server's "Export report": a new `agent-trace-report-<traceId>-<time>` directory in the
 * working directory. The error message reaches the browser, so it is redacted too.
 */
export async function exportReport(
  store: TraceStore,
  input: ExportReportInput,
  now = new Date(),
): Promise<ExportReportResult> {
  const home = homeDir()
  try {
    const report = await store.withEvents(input.traceId, read => reportOf(store, input.traceId, read, input.locale))
    const outDir = await serialized(async () => {
      const dir = await reserveDir(
        resolve(
          process.cwd(),
          `agent-trace-report-${input.traceId.replaceAll(/[^\w-]/g, '').slice(0, 8)}-${stamp(now)}`,
        ),
      )
      await buildSite(dir, report)
      return dir
    })
    // Absolute, so the browser can say exactly where; the home directory shows as `~`.
    return {
      path: redactText(join(outDir, 'index.html'), { home }),
      included: report.events.length,
      total: report.total,
    }
  } catch (error) {
    // No cause: it would carry the unredacted home path to the browser.
    throw new Error(redactText(error instanceof Error ? error.message : String(error), { home }))
  }
}
