import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { ReportTrace } from '@rivus/estela-rpc'
import { firstIssue, traceEventSchema, traceSchema } from '@rivus/estela-schema'
import * as z from 'zod/mini'
import { LOCALES } from '@/i18n/locale.ts'

/** Must match `REPORT_ELEMENT_ID` in `apps/cli/src/report/report-site.ts`: the baked `report-trace` output. Read once, in `main.tsx`. */
const REPORT_ELEMENT_ID = 'report-trace'

const sessionSummarySchema = z.object({
  turns: z.optional(z.number()),
  requests: z.optional(z.number()),
  inputTokens: z.optional(z.number()),
  outputTokens: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  compactions: z.optional(z.number()),
  subagents: z.optional(z.number()),
  failedTools: z.optional(z.number()),
  contextShape: z.optional(z.array(z.number())),
}) satisfies z.ZodMiniType<SessionSummary, SessionSummary>

/**
 * The baked JSON as `buildReport` writes it. The `satisfies` checks one direction, that what the schema accepts is a
 * `ReportTrace`; `report.test.ts` checks the other, that every `ReportTrace` passes, so a field the kit's
 * `SessionSummary` widens or a language rpc's `ReportLocale` adds fails the type check, not the report page at load.
 */
export const reportTraceSchema = z.object({
  trace: traceSchema,
  summary: sessionSummarySchema,
  events: z.array(z.intersection(traceEventSchema, z.object({ originalUnavailable: z.optional(z.string()) }))),
  total: z.number(),
  truncated: z.boolean(),
  locale: z.optional(z.enum(LOCALES)),
}) satisfies z.ZodMiniType<ReportTrace, ReportTrace>

/** Schema guard that throws with the first issue; a report that passes is the parsed JSON itself. */
function assertReportTrace(value: unknown): asserts value is ReportTrace {
  const parsed = z.safeParse(reportTraceSchema, value)
  if (!parsed.success) {
    throw new TypeError(`report-trace: ${firstIssue(parsed.error)}`)
  }
}

/** The `report-trace` JSON as a `ReportTrace`, or a `TypeError` naming the first field that does not match. */
export function parseReportTrace(text: string): ReportTrace {
  const value: unknown = JSON.parse(text)
  assertReportTrace(value)
  return value
}

/**
 * The report this page is, or `undefined` on the dev server. `build` and "Export report" put
 * the `report-trace` snapshot into `index.html` as JSON, because a page opened from `file://`
 * cannot fetch DevFrame's static dump. Finding it starts report mode: the workspace
 * only, and no call that needs a server.
 */
export function reportTrace(): ReportTrace | undefined {
  const text = document.getElementById(REPORT_ELEMENT_ID)?.textContent
  return text ? parseReportTrace(text) : undefined
}
