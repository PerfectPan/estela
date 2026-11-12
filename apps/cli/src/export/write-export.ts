import type { Trace } from '@rivus/estela-schema'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { toAtif, toOtlp } from '@rivus/estela-kernel'
import { redact, redactText } from '@rivus/agent-kit/redact'
import { homeDir } from '@rivus/estela-runtime-node'

export type ExportFormat = 'atif' | 'otlp'

/** The projection of one export command: ATIF v1.8 or OTLP/JSON. */
export function exportOf(trace: Trace, format: ExportFormat): unknown {
  return format === 'atif' ? toAtif(trace) : toOtlp(trace)
}

/** `estela-<session id prefix>.atif.json` / `.otlp.json` in the working directory. */
export function defaultExportPath(sessionId: string, format: ExportFormat): string {
  const short = sessionId.replaceAll(/[^\w-]/g, '').slice(0, 8) || 'session'
  return resolve(process.cwd(), `estela-${short}.${format}.json`)
}

/**
 * Serializes the export (two-space JSON) and writes it, creating the directory when
 * `--out` names one that does not exist yet. `redacts` is the CLI's reading of
 * `ESTELA_REDACT`; the returned path always shows `~` for home.
 */
export async function writeExport(
  trace: Trace,
  format: ExportFormat,
  outFile: string | undefined,
  redacts: boolean,
): Promise<string> {
  const home = homeDir()
  const path = outFile !== undefined ? resolve(outFile) : defaultExportPath(trace.session.id, format)
  const value = exportOf(trace, format)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(redacts ? redact(value, { home }) : value, null, 2)}\n`, 'utf8')
  return redactText(path, { home })
}
