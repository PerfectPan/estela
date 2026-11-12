import type { ReportTrace, ResolvedSession } from '@rivus/estela-rpc'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { bindTraceStore, CURRENT_TRACE_ID } from '@rivus/estela-rpc'
import { reportOf, writeReport } from '../../report/report.ts'
import { createTraceStore } from '../../server/trace-store.ts'
import { sessionLoader } from '../../sessions/load-session.ts'
import { sessionTargetLabel } from '../../sessions/session-target.ts'
import { CliError } from '../failure.ts'
import { sayBuild, sayStoreWarning } from '../ui/terminal.ts'

export interface BuildInput {
  target: SessionTarget
  outDir: string
}

/** One session as a report directory. A report is always redacted, whatever ESTELA_REDACT says. */
export async function runBuild(input: BuildInput, packageVersion: string): Promise<void> {
  const label = sessionTargetLabel(input.target)
  const current: ResolvedSession = { key: label, target: input.target }
  const load = sessionLoader(input.target, createNodePlatform())
  const traces = createTraceStore({ redacts: true, log: sayStoreWarning })
  bindTraceStore(traces.store)
  let report: ReportTrace | undefined
  try {
    await sayBuild(packageVersion, {
      load: async () => {
        const trace = await load()
        // One load per build: the store gets this trace, so nothing reads the file again.
        await traces.seed(current, trace)
        return `${trace.events.length} events`
      },
      redact: async () => {
        const byId = new Map((await load()).events.map(event => [event.id, event]))
        report = await reportOf(traces.store, CURRENT_TRACE_ID, async ids => ids.map(id => byId.get(id)!))
        const included = report.truncated ? `; original records for the first ${report.events.length}` : ''
        return `redacted ${report.total} events${included}`
      },
      write: async () => {
        await writeReport(input.outDir, report!)
        return input.outDir
      },
    })
  } catch (cause) {
    throw new CliError({ kind: 'session', action: 'build', label, cause })
  }
}
