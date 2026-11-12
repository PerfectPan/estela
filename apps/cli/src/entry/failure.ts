import { errorMessage } from '../sessions/read-failure.ts'

const SESSION_FIX = 'Pass a canonical agent-trace JSON file, or a session path a registered agent adapter accepts.'

/** Every way a command fails on purpose. Any other error is a bug and keeps its stack. */
export type CliFailure =
  | { kind: 'usage'; detail: string }
  | { kind: 'session'; action: 'load' | 'build' | 'export'; label: string; cause: unknown }
  | { kind: 'index'; cause: unknown }
  | { kind: 'no-sessions' }
  | { kind: 'cancelled' }

/** Thrown by a command for an expected failure; `app.ts` turns it into output and an exit code. */
export class CliError extends Error {
  readonly failure: CliFailure

  constructor(failure: CliFailure) {
    super(`agent-trace: ${failure.kind} failure`)
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
      return { message: { cause: failure.detail, fix: 'Run agent-trace --help for usage.' }, exitCode: 1 }
    case 'session':
      return {
        message: {
          cause: `Could not ${failure.action} ${failure.label}: ${errorMessage(failure.cause)}`,
          fix: SESSION_FIX,
        },
        exitCode: 1,
      }
    case 'index':
      return {
        message: {
          cause: `Could not index sessions: ${errorMessage(failure.cause)}`,
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
