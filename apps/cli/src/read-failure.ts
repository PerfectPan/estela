import { redactText } from '@rivus/agent-trace-kernel'

export interface ReadFailure {
  reason: string
  line?: number
  file?: string
}

/**
 * Split `host: <file>:<line>: <reason>` (the kernel's `generationError` shape) into its parts.
 * Any other message becomes the reason. The home directory is shown as `~`.
 */
export function parseReadFailure(message: string, homeDir: string, fallbackFile?: string): ReadFailure {
  const match = message.match(/:(\d+): (.*)$/)
  if (!match || match.index == null) {
    return {
      reason: redactText(message, homeDir),
      ...(fallbackFile ? { file: redactText(fallbackFile, homeDir) } : {}),
    }
  }
  const head = message.slice(0, match.index)
  const colon = head.indexOf(': ')
  const file = colon === -1 ? fallbackFile : head.slice(colon + 2)
  return {
    reason: redactText(match[2] || message, homeDir),
    line: Number(match[1]),
    ...(file ? { file: redactText(file, homeDir) } : {}),
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause.message)
    return `${error.message}: ${error.cause.message}`
  return error instanceof Error ? error.message : String(error)
}
