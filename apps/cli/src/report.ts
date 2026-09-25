import type { ExportReportInput, ExportReportResult, ReportTrace, TraceStore } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { redact, redactText } from '@rivus/agent-trace-kernel'
import { bindReportSource, buildReport } from '@rivus/agent-trace-rpc'
import { homeDir } from '@rivus/agent-trace-runtime-node'
import { createBuild } from 'devframe/adapters/build'
import devframe from './devframe.ts'
import { packForFile } from './report-site.ts'

/** The report is always redacted (plan D10), whatever `AGENT_TRACE_REDACT` says. */
function redactAll<T>(value: T): T {
  return redact(value, { homeDir: homeDir() })
}

/** `build`: the view from the store seeded with `trace`, and the full events from `trace` itself (no second read). */
export async function reportOfLoaded(store: TraceStore, ref: string, trace: Trace): Promise<ReportTrace> {
  const byId = new Map(trace.events.map(event => [event.id, event]))
  return buildReport({
    view: await store.view(ref),
    full: async ids => ids.map(id => byId.get(id)!),
    redact: redactAll,
  })
}

/** "Export report": the view and the first events in full through the store (originals read by source pointer). */
export async function reportOfStored(store: TraceStore, input: ExportReportInput): Promise<ReportTrace> {
  return buildReport({
    view: await store.view(input.ref),
    full: ids => store.events(input.ref, ids),
    redact: redactAll,
    locale: input.locale,
  })
}

let writing: Promise<unknown> = Promise.resolve()

/**
 * DevFrame's static build with `report-trace` bound to `report`, then `packForFile`. One at a
 * time: the binding is module state, and DevFrame's build replaces `outDir`.
 */
export function writeReport(outDir: string, report: ReportTrace): Promise<void> {
  const run = writing.then(async () => {
    bindReportSource(async () => report)
    await createBuild(devframe, { outDir })
    await packForFile(outDir)
  })
  writing = run.catch(() => {})
  return run
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function stamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** The dev server's "Export report": a new `agent-trace-report-<ref>-<time>` directory in the working directory. */
export async function exportReport(store: TraceStore, input: ExportReportInput, now = new Date()): Promise<ExportReportResult> {
  const report = await reportOfStored(store, input)
  const base = resolve(process.cwd(), `agent-trace-report-${input.ref.replaceAll(/[^\w-]/g, '').slice(0, 8)}-${stamp(now)}`)
  // DevFrame's build empties `outDir` first, so never reuse one.
  let outDir = base
  for (let n = 2; existsSync(outDir); n++)
    outDir = `${base}-${n}`
  await writeReport(outDir, report)
  return {
    // Absolute, so the browser can say exactly where; the home directory shows as `~`.
    path: redactText(join(outDir, 'index.html'), homeDir()),
    included: report.events.length,
    total: report.total,
    truncated: report.truncated,
  }
}
