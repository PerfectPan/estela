import { builtinProviders, type Provider } from '@rivus/agent-kit/providers'
import type { SessionAdapter, SessionAdapters } from '@rivus/agent-kit/sessions'

export const builtinAdapters: SessionAdapters = Object.fromEntries(
  builtinProviders.flatMap(provider => (provider.sessions ? [[provider.id, provider.sessions]] : [])),
)

/**
 * Product names for the adapters that name themselves with their id (the kit's OpenCode and ZCode), as the
 * workspace and the README spell them.
 */
const PRODUCT_NAMES: Partial<Record<string, string>> = { opencode: 'OpenCode', zcode: 'ZCode' }

/** The product name the rail, the list, and the picker show. */
export function adapterDisplayName(adapter: SessionAdapter): string {
  return PRODUCT_NAMES[adapter.agent] ?? adapter.displayName
}

/**
 * Agents that keep every session as rows of one SQLite database, which the kit's adapters do not say. All of its
 * sessions share the database file's stamp, and a commit can sit in its write-ahead log without touching the file, so
 * the catalog adds the log to the stamp and always puts the session id in the trace id.
 *
 * A row is keyed by its session's `lastActiveAt` instead, which moves with every write to that session, so a write to
 * one session leaves the others' cached summaries alone. OpenCode's does, ZCode's did on a real 0.16.5 database (no
 * message or part written after its session's `time_updated`), and DimCode's is the latest write across the session,
 * its messages, and its usage ledger. A subagent's writes to its own session row do not move its parent's, so a
 * parent's cached summary, which counts the subagent lanes, can lag a running subagent.
 */
const DATABASE_AGENTS: ReadonlySet<string> = new Set(['opencode', 'zcode', 'dim'])

export function keepsSessionsInDatabase(agent: string): boolean {
  return DATABASE_AGENTS.has(agent)
}

/** Adapt the shell's reader registry to the kit's provider SPI. */
export function sessionProviders(adapters: SessionAdapters): Provider[] {
  return Object.values(adapters).flatMap(adapter => (adapter ? [{ id: adapter.agent, sessions: adapter }] : []))
}
