import type { ReportTrace } from '@rivus/agent-trace-rpc'

/** Must match `REPORT_ELEMENT_ID` in `apps/cli/src/report-site.ts`: the baked `report-trace` output. */
const REPORT_ELEMENT_ID = 'report-trace'

let cached: { report: ReportTrace | undefined } | undefined

/**
 * The report this page is, or `undefined` on the dev server. `build` and "Export report" put
 * the `report-trace` snapshot into `index.html` as JSON, because a page opened from `file://`
 * cannot fetch DevFrame's static dump. Finding it starts report mode (plan D8): the workspace
 * only, and no call that needs a server.
 */
export function reportTrace(): ReportTrace | undefined {
  if (!cached) {
    const text = document.getElementById(REPORT_ELEMENT_ID)?.textContent
    cached = { report: text ? JSON.parse(text) as ReportTrace : undefined }
  }
  return cached.report
}
