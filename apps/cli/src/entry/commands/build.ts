import type { ReportTrace } from '@rivus/estela-rpc'
import type { Trace } from '@rivus/estela-schema'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { CURRENT_TRACE_ID } from '@rivus/estela-rpc'
import { checkReportOutDir, reportOf, ReportOutDirError, sessionTargetLabel, writeReport } from '@rivus/estela-server'
import { createEstelaServer } from '../../server.ts'
import { CliError } from '../failure.ts'
import { sayBuild, sayStoreWarning } from '../ui/terminal.ts'

export interface BuildInput {
  target: SessionTarget
  outDir: string
}

/** One session as a report directory. A report is always redacted, whatever ESTELA_REDACT says. */
export async function runBuild(input: BuildInput, packageVersion: string): Promise<void> {
  const label = sessionTargetLabel(input.target)
  const server = createEstelaServer({ catalog: undefined, launch: input.target, redacts: true, log: sayStoreWarning })
  let trace: Trace | undefined
  let report: ReportTrace | undefined
  try {
    await checkReportOutDir(input.outDir)
    await sayBuild(packageVersion, {
      load: async () => {
        // One load per build: the store gets this trace, so nothing reads the file again.
        trace = (await server.openLaunch())!.trace
        return `${trace.events.length} events`
      },
      redact: async () => {
        const byId = new Map(trace!.events.map(event => [event.id, event]))
        report = await reportOf(server.store, CURRENT_TRACE_ID, async ids => ids.map(id => byId.get(id)!))
        const included = report.truncated ? `; original records for the first ${report.events.length}` : ''
        return `redacted ${report.total} events${included}`
      },
      write: async () => {
        await writeReport(server.definition, input.outDir, report!)
        return input.outDir
      },
    })
  } catch (cause) {
    if (cause instanceof ReportOutDirError) {
      throw new CliError({ kind: 'output', action: 'build', cause })
    }
    throw new CliError({ kind: 'session', action: 'build', label, cause })
  } finally {
    server.close()
  }
}
