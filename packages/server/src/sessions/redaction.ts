import { redact, redactText } from '@rivus/agent-kit/redact'
import { homeDir } from '@rivus/estela-runtime-node'

/** Session text with every home directory hidden, as a list row or an error shows it. */
export type Redactor = (text: string) => string

/** How one server redacts: a whole value (every string in it) or one string. */
export interface HomeRedaction {
  value: <T>(value: T) => T
  text: Redactor
}

/**
 * Redaction with every home in `homes`: one pass of the kit's `redact` per home, since its patterns cover one
 * home at a time.
 */
export function homeRedaction(...homes: readonly string[]): HomeRedaction {
  const unique = [...new Set(homes)]
  return {
    // Whole-value passes one after the other: the kit builds its patterns per home and keeps only the last
    // built, so a value walked string by string with alternating homes would rebuild them for each string.
    value: <T>(value: T): T => unique.reduce((passed, home) => redact(passed, { home }), value),
    text: text => unique.reduce((passed, home) => redactText(passed, { home }), text),
  }
}

/**
 * The redaction of one server, in its always-redacting outputs (reports, MCP tool results and errors, list rows'
 * working directories and read errors, the index's own failure reason).
 *
 * Two homes, because either can be in what a server sends out. Recorded session content (titles, prompts, event
 * text, a session's working directory) names the home of whoever ran the agent, which is `platform.home`; it can
 * also name the home of the user the server runs as, such as a tool output that printed a shell path. What the
 * server itself produces, such as a report build's error message, names the process home. The CLI's platform
 * home is the process home, so its outputs are passed through once.
 */
export function serverRedaction(home: string): HomeRedaction {
  return homeRedaction(home, homeDir())
}
