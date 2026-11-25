import type { Trace } from '@rivus/estela-schema'
import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import * as z from 'zod/mini'
import { snapshotPricing, toAtif, toOtlp } from '@rivus/estela-kernel'
import { redactText } from '@rivus/agent-kit/redact'
import { homeDir } from '@rivus/estela-runtime-node'
import { homeRedaction } from '@rivus/estela-server'

export type ExportFormat = 'atif' | 'otlp'

const MAX_DEFAULT_ATTEMPTS = 10_000
const errnoSchema = z.object({ code: z.string() })

/** Error raised when an export output path is unsafe or already blocked (e.g., a symlink or directory). */
export class ExportPathError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(message)
    this.name = 'ExportPathError'
    this.path = path
  }
}

function errorCode(error: unknown): string | undefined {
  const parsed = errnoSchema.safeParse(error)
  return parsed.success ? parsed.data.code : undefined
}

function defaultExportCandidate(sessionId: string, format: ExportFormat, attempt: number): string {
  const short = sessionId.replaceAll(/[^\w-]/g, '').slice(0, 8) || 'session'
  const suffix = attempt === 1 ? '' : `-${attempt}`
  return resolve(process.cwd(), `estela-${short}${suffix}.${format}.json`)
}

/**
 * The projection of one export command: ATIF v1.8 or OTLP/JSON.
 * @internal
 */
export function exportOf(trace: Trace, format: ExportFormat): unknown {
  return format === 'atif' ? toAtif(trace, { pricing: snapshotPricing() }) : toOtlp(trace)
}

/**
 * `estela-<session id prefix>.atif.json` / `.otlp.json` in the working directory.
 * @internal
 */
export function defaultExportPath(sessionId: string, format: ExportFormat): string {
  return defaultExportCandidate(sessionId, format, 1)
}

/** Whether `path` names an entry, a dangling symbolic link included. */
async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function writeDefaultUnique(
  sessionId: string,
  format: ExportFormat,
  payload: string,
  home: string,
): Promise<string> {
  const firstPath = defaultExportPath(sessionId, format)
  await mkdir(dirname(firstPath), { recursive: true })
  for (let attempt = 1; attempt <= MAX_DEFAULT_ATTEMPTS; attempt += 1) {
    const candidate = defaultExportCandidate(sessionId, format, attempt)
    // Windows' `wx` (CREATE_NEW) follows a dangling symbolic link and creates its target; POSIX `wx`
    // refuses any existing entry on its own. So an entry of any kind, a link included, is taken. On
    // Windows a link created between this check and the open is still followed: that needs write
    // access to the directory and the right to create symbolic links.
    if (await entryExists(candidate)) {
      continue
    }
    try {
      const handle = await open(candidate, 'wx')
      try {
        await handle.writeFile(payload, 'utf8')
      } finally {
        await handle.close()
      }
      return candidate
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        continue
      }
      throw error
    }
  }
  throw new ExportPathError(firstPath, `No unused export filename available near ${redactText(firstPath, { home })}`)
}

async function writeExplicitTarget(path: string, payload: string, home: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) {
      throw new ExportPathError(path, `Refusing to write export through symbolic link: ${redactText(path, { home })}`)
    }
    if (stats.isDirectory()) {
      throw new ExportPathError(path, `Export path is a directory: ${redactText(path, { home })}`)
    }
  } catch (error) {
    if (error instanceof ExportPathError) {
      throw error
    }
    if (errorCode(error) !== 'ENOENT') {
      throw error
    }
  }

  // Bitwise OR with `constants.O_NOFOLLOW` leaves flags intact even if `O_NOFOLLOW` is 0 or absent on Windows.
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, flags, 0o666)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ELOOP' || code === 'EMLINK') {
      throw new ExportPathError(path, `Refusing to write export through symbolic link: ${redactText(path, { home })}`)
    }
    if (code === 'EISDIR') {
      throw new ExportPathError(path, `Export path is a directory: ${redactText(path, { home })}`)
    }
    throw error
  }
  try {
    await handle.writeFile(payload, 'utf8')
  } finally {
    await handle.close()
  }
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
  const value = exportOf(trace, format)
  // The server's redaction: it keeps every value of object keys that redact to the same text, as in a tool call's arguments.
  const payload = `${JSON.stringify(redacts ? homeRedaction(home).value(value) : value, null, 2)}\n`
  if (outFile === undefined) {
    const written = await writeDefaultUnique(trace.session.id, format, payload, home)
    return redactText(written, { home })
  }
  const path = resolve(outFile)
  await writeExplicitTarget(path, payload, home)
  return redactText(path, { home })
}
