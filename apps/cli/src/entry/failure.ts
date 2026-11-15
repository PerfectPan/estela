import { stripVTControlCharacters } from 'node:util'
import * as z from 'zod/mini'
import { errorMessage, oneLine } from '@rivus/estela-server'

const SESSION_FIX = 'Pass a canonical Estela JSON file, or a session path a registered agent adapter accepts.'

const errorShapeSchema = z.object({
  code: z.optional(z.string()),
  syscall: z.optional(z.string()),
  cause: z.optional(z.unknown()),
})

export function sanitizeInline(text: string): string {
  return oneLine(stripVTControlCharacters(text))
}

function sanitizeLines(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/\p{Cf}+/gu, '')
    .split('\n')
    .map(line => line.replace(/\p{Cc}+/gu, ' ').trimEnd())
    .join('\n')
}

function nestedErrnoCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 3; depth += 1) {
    const parsed = errorShapeSchema.safeParse(current)
    if (!parsed.success) {
      return undefined
    }
    if (parsed.data.code && parsed.data.code !== 'DF0052') {
      return parsed.data.code
    }
    if (parsed.data.cause === undefined) {
      return parsed.data.code
    }
    current = parsed.data.cause
  }
  return undefined
}

/** True when `error` is a bind/listen failure (including DevFrame `DF0052`). */
export function isListenFailure(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3; depth += 1) {
    const parsed = errorShapeSchema.safeParse(current)
    if (!parsed.success) {
      return false
    }
    if (parsed.data.code === 'DF0052') {
      return true
    }
    if (parsed.data.syscall === 'listen' || parsed.data.syscall === 'getaddrinfo') {
      return true
    }
    if (parsed.data.cause === undefined) {
      return false
    }
    current = parsed.data.cause
  }
  return false
}

function listenMessage(host: string, port: number | undefined, cause: unknown): { cause: string; fix: string } {
  const code = nestedErrnoCode(cause)
  if (code === 'EADDRINUSE' && port !== undefined) {
    return {
      cause: `Port ${port} is already in use.`,
      fix: `Stop the process using port ${port}, or pass --port with a free port (or omit --port).`,
    }
  }
  if (code === 'EACCES' && port !== undefined) {
    return {
      cause: `Permission denied listening on ${sanitizeInline(host)}:${port}.`,
      fix: 'Choose a port above 1024, or omit --port.',
    }
  }
  if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND') {
    return {
      cause: `Cannot listen on host ${sanitizeInline(host)}: ${sanitizeInline(errorMessage(cause))}.`,
      fix: 'Pass a local address such as localhost or 127.0.0.1 with --host.',
    }
  }
  return {
    cause: `Could not start server: ${sanitizeInline(errorMessage(cause))}`,
    fix: 'Check --host and --port, or omit --port to let Estela pick a free port.',
  }
}

/** Every way a command fails on purpose. Any other error is a bug and keeps its stack. */
export type CliFailure =
  | { kind: 'usage'; detail: string }
  | { kind: 'session'; action: 'load' | 'build' | 'export'; label: string; cause: unknown }
  | { kind: 'output'; action: 'build' | 'export'; cause: unknown }
  | { kind: 'listen'; host: string; port: number | undefined; cause: unknown }
  | { kind: 'index'; cause: unknown }
  | { kind: 'no-sessions' }
  | { kind: 'cancelled' }

/** Thrown by a command for an expected failure; `app.ts` turns it into output and an exit code. */
export class CliError extends Error {
  readonly failure: CliFailure

  constructor(failure: CliFailure) {
    super(`estela: ${failure.kind} failure`)
    this.name = 'CliError'
    this.failure = failure
  }
}

export interface FailureReport {
  /** The cause and one line on how to fix it; absent when the terminal already said it. */
  message?: { cause: string; fix: string }
  exitCode: number
}

/** What the terminal shows for each failure and the exit code. A kind without a case fails the type check. */
export function failureReport(failure: CliFailure): FailureReport {
  switch (failure.kind) {
    case 'usage':
      return { message: { cause: sanitizeLines(failure.detail), fix: 'Run estela --help for usage.' }, exitCode: 1 }
    case 'session':
      return {
        message: {
          cause: `Could not ${failure.action} ${sanitizeInline(failure.label)}: ${sanitizeInline(errorMessage(failure.cause))}`,
          fix: SESSION_FIX,
        },
        exitCode: 1,
      }
    case 'output':
      return {
        message: {
          cause: `Could not write ${failure.action} output: ${sanitizeInline(errorMessage(failure.cause))}`,
          fix:
            failure.action === 'build'
              ? 'Pass an empty directory or an earlier Estela report directory with --out-dir.'
              : 'Pass a different path with --out, or remove the blocking symlink.',
        },
        exitCode: 1,
      }
    case 'listen':
      return { message: listenMessage(failure.host, failure.port, failure.cause), exitCode: 1 }
    case 'index':
      return {
        message: {
          cause: `Could not index sessions: ${sanitizeInline(errorMessage(failure.cause))}`,
          fix: 'Check the agent session directories, or pass --no-index.',
        },
        exitCode: 1,
      }
    case 'no-sessions':
      return { message: { cause: 'No sessions to pick.', fix: SESSION_FIX }, exitCode: 1 }
    case 'cancelled':
      // The picker printed its own cancel line.
      return { exitCode: 1 }
  }
}
