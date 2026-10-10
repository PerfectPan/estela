import type { SessionError } from '@rivus/agent-trace-rpc'
import type { LoadTranscriptError } from '@rivus/agent-kit/transcript'
import type { SessionListError } from '@rivus/agent-kit/sessions'
import { redactText } from '@rivus/agent-kit/redact'

/**
 * Split `host: <file>:<line>: <reason>` into its parts. `ReadFailed` messages are free-form IO
 * text, and this shape is where a line number in them comes from; any other message becomes the
 * reason. The home directory is shown as `~`.
 */
export function parseReadFailure(message: string, homeDir: string, fallbackFile?: string): SessionError {
  const match = message.match(/:(\d+): (.*)$/)
  if (!match || match.index == null) {
    return {
      reason: redactText(message, { home: homeDir }),
      ...(fallbackFile ? { file: redactText(fallbackFile, { home: homeDir }) } : {}),
    }
  }
  const head = message.slice(0, match.index)
  const colon = head.indexOf(': ')
  const file = colon === -1 ? fallbackFile : head.slice(colon + 2)
  return {
    reason: redactText(match[2] || message, { home: homeDir }),
    line: Number(match[1]),
    ...(file ? { file: redactText(file, { home: homeDir }) } : {}),
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause.message) {
    return `${error.message}: ${error.cause.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** A listing failure for one file. `RootMissing` never reaches a row: the root stat records it. */
export function listError(error: SessionListError, homeDir: string): SessionError {
  if (error._tag === 'ReadFailed') {
    return parseReadFailure(error.message, homeDir, error.path)
  }
  return { reason: 'session directory does not exist', file: redactText(error.path, { home: homeDir }) }
}

/** A failed transcript load, mapped from the kit's tagged errors to the wire `SessionError`. */
export function loadError(error: LoadTranscriptError, homeDir: string): SessionError {
  switch (error._tag) {
    case 'UnknownFormatGeneration':
      return {
        reason: 'unknown format generation',
        line: error.line,
        file: redactText(error.file, { home: homeDir }),
      }
    case 'SessionNotFound':
      return { reason: 'session file does not exist', file: redactText(error.path, { home: homeDir }) }
    case 'ReadFailed':
      return parseReadFailure(error.message, homeDir, error.path)
    case 'NoAdapterAccepted':
      return { reason: 'no session adapter recognized this file', file: redactText(error.path, { home: homeDir }) }
    case 'CapabilityUnsupported':
      return { reason: `no session adapter for ${error.agent}` }
  }
}
