import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { ExportPathError, writeExport, type ExportFormat } from '../../export/write-export.ts'
import { loadSession, sessionTargetLabel } from '@rivus/estela-server'
import { CliError } from '../failure.ts'
import { sayWrote } from '../ui/terminal.ts'

export interface ExportInput {
  target: SessionTarget
  format: ExportFormat
  /** `--out`; `undefined` writes `estela-<session>.<format>.json` in the working directory. */
  out: string | undefined
  /** `false` only with ESTELA_REDACT=0. */
  redacts: boolean
}

/** One session as an ATIF or OTLP file. */
export async function runExport(input: ExportInput): Promise<void> {
  const label = sessionTargetLabel(input.target)
  try {
    const trace = await loadSession(input.target, { platform: createNodePlatform() })
    sayWrote(await writeExport(trace, input.format, input.out, input.redacts))
  } catch (cause) {
    if (cause instanceof ExportPathError) {
      throw new CliError({ kind: 'output', action: 'export', cause })
    }
    throw new CliError({ kind: 'session', action: 'export', label, cause })
  }
}
