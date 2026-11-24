import type { SessionError } from '@rivus/estela-rpc'
import type { LoadTranscriptError } from '@rivus/agent-kit/transcript'
import type { SessionListError } from '@rivus/agent-kit/sessions'
import type { Redactor } from './redaction.ts'

/**
 * Split `agent: <file>:<line>: <reason>` into its parts. `ReadFailed` messages are free-form IO
 * text, and this shape is where a line number in them comes from; any other message becomes the
 * reason. The home directory is shown as `~`.
 */
export function parseReadFailure(message: string, redact: Redactor, fallbackFile?: string): SessionError {
  const match = message.match(/:(\d+): (.*)$/)
  if (!match || match.index == null) {
    return {
      reason: redact(message),
      ...(fallbackFile ? { file: redact(fallbackFile) } : {}),
    }
  }
  const head = message.slice(0, match.index)
  const colon = head.indexOf(': ')
  const file = colon === -1 ? fallbackFile : head.slice(colon + 2)
  return {
    reason: redact(match[2] || message),
    line: Number(match[1]),
    ...(file ? { file: redact(file) } : {}),
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause.message) {
    return `${error.message}: ${error.cause.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * The message of a load failure, for the thrown `Error` and the error row alike: `parseReadFailure`
 * splits it back into the wire `SessionError`.
 */
export function loadErrorMessage(error: LoadTranscriptError, targetLabel: string): string {
  switch (error._tag) {
    case 'SessionNotFound':
      return `${targetLabel} does not exist`
    case 'NoAdapterAccepted':
      return `No adapter accepted ${targetLabel}`
    case 'UnknownFormatGeneration':
      return `${error.agent}: ${error.file}:${error.line}: unknown format generation`
    case 'ReadFailed':
      return error.message
    case 'CapabilityUnsupported':
      return `no session adapter for ${error.agent}`
  }
}

/**
 * A failed transcript load as a wire `SessionError`: the `loadErrorMessage` text, parsed back.
 * A missing file is the one wording without the path in the reason — `session file does not
 * exist`, with the path in `file` — everywhere the catalog shows it.
 */
export function loadFailure(
  error: LoadTranscriptError,
  redact: Redactor,
  targetLabel: string,
  fallbackFile?: string,
): SessionError {
  if (error._tag === 'SessionNotFound') {
    return { reason: 'session file does not exist', file: redact(fallbackFile ?? targetLabel) }
  }
  return parseReadFailure(loadErrorMessage(error, targetLabel), redact, fallbackFile)
}

/** A listing failure for one file. `RootMissing` never reaches a row: the root stat records it. */
export function listError(error: SessionListError, redact: Redactor): SessionError {
  if (error._tag === 'ReadFailed') {
    return parseReadFailure(error.message, redact, error.path)
  }
  return { reason: 'session directory does not exist', file: redact(error.path) }
}
