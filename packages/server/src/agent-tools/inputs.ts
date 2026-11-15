import * as z from 'zod/mini'

/**
 * Tool inputs (`docs/reference/mcp-tools.md`). Each schema both parses what an MCP client sends and is the JSON Schema the tool
 * advertises (`inputJsonSchema`), so the two cannot drift. Objects are strict: an unknown key is an error, not
 * silently ignored. Every check sets `error`, which is the message the client sees after the tool and field name.
 */

const TRACE_ID = 'expected a trace id string from estela_list_sessions, or "current"'
const EVENT_ID = 'expected a non-empty event id string'
const OFFSET = 'expected an integer from 0 to 100000'
const TIME = 'expected an ISO 8601 date, or a date-time with Z or an offset, such as 2026-11-01 or 2026-11-01T09:30:00Z'
/**
 * A date alone (read as 00:00 UTC), or a date-time with its zone. `Date.parse` reads a date-time without a zone in
 * the server's local time, so that form is refused rather than guessed.
 */
const DATE_OR_ZONED = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/

const traceId = z.optional(
  z
    .string({ error: TRACE_ID })
    .check(
      z.minLength(1, { error: TRACE_ID }),
      z.maxLength(200, { error: TRACE_ID }),
      z.describe(
        'Session to read: a traceId from estela_list_sessions or estela_search_sessions. Leave it out for "current", the session the server was started with (only `estela mcp <path>` and a dev server started with a path have one).',
      ),
    ),
)

const eventId = z
  .string({ error: EVENT_ID })
  .check(
    z.minLength(1, { error: EVENT_ID }),
    z.maxLength(200, { error: EVENT_ID }),
    z.describe('An event id as another estela tool returned it, including the `@e<n>` form.'),
  )

/** An optional bounded integer: the field's error names the range, so the client sees one message for it. */
function boundedInt(min: number, max: number, error: string, description: string) {
  return z.optional(z.int({ error }).check(z.gte(min, { error }), z.lte(max, { error }), z.describe(description)))
}

const offset = boundedInt(
  0,
  100_000,
  OFFSET,
  'Skip this many items; pass the previous result’s `nextOffset` to read the next page. Default 0.',
)

function limit(max: number, fallback: number) {
  return boundedInt(
    1,
    max,
    `expected an integer from 1 to ${max}`,
    `Most items to return, default ${fallback}, at most ${max}. A page also ends early to keep the result under its size bound; \`nextOffset\` is then set.`,
  )
}

function time(description: string) {
  return z.optional(
    z.string({ error: TIME }).check(
      z.refine(value => DATE_OR_ZONED.test(value) && !Number.isNaN(Date.parse(value)), { error: TIME }),
      z.describe(description),
    ),
  )
}

function flag(description: string) {
  const error = 'expected true or false'
  return z.optional(z.boolean({ error }).check(z.describe(description)))
}

function text(max: number, description: string) {
  const error = `expected a string of at most ${max} characters`
  return z.optional(z.string({ error }).check(z.maxLength(max, { error }), z.describe(description)))
}

/** The session filters `estela_list_sessions` and `estela_search_sessions` share. */
const sessionFilters = {
  agent: text(64, 'Only sessions of this agent, such as `claude-code`, `codex`, or `grok`.'),
  project: text(
    500,
    'Only sessions whose project name (the last segment of the working directory) contains this text, ignoring case.',
  ),
  cwd: text(
    1000,
    'Only sessions whose working directory is this directory or inside it. An absolute path, or one starting with `~`.',
  ),
  since: time('Only sessions active at or after this time.'),
  until: time('Only sessions that started at or before this time (their last activity when no start is recorded).'),
  hasCompaction: flag(
    'true: only sessions with at least one recorded compaction; false: only sessions that record compactions and have none.',
  ),
  hasFailedTools: flag(
    'true: only sessions with at least one failed tool call; false: only sessions that record tool failures and have none.',
  ),
  offset,
  limit: limit(50, 20),
}

const QUERY = 'expected a search text of 1 to 200 characters'

export const listSessionsInput = z.strictObject(sessionFilters, { error: 'expected an object' })
export const searchSessionsInput = z.strictObject(
  {
    query: z
      .string({ error: QUERY })
      .check(
        z.minLength(1, { error: QUERY }),
        z.maxLength(200, { error: QUERY }),
        z.describe(
          'Text to find in session titles and the user’s own prompts (not in replies, tool output, or files). Matching ignores case.',
        ),
      ),
    ...sessionFilters,
  },
  { error: 'expected an object' },
)
export const sessionSummaryInput = z.strictObject({ traceId }, { error: 'expected an object' })
export const listTurnsInput = z.strictObject(
  { traceId, offset, limit: limit(100, 20) },
  { error: 'expected an object' },
)
export const listRequestsInput = z.strictObject(
  {
    traceId,
    lane: text(200, 'Only requests on this lane (a lane id from estela_session_summary).'),
    turn: boundedInt(0, 100_000, OFFSET, 'Only requests in this turn (`index` from estela_list_turns).'),
    offset,
    limit: limit(200, 50),
  },
  { error: 'expected an object' },
)

const MAX_CHARS = 'expected an integer from 256 to 20000'
export const getEventInput = z.strictObject(
  {
    traceId,
    eventId,
    maxChars: boundedInt(
      256,
      20_000,
      MAX_CHARS,
      'Longest string to return whole, default 2000, at most 20000. Longer strings are cut and listed in `truncated`.',
    ),
    original: flag('Also return the record the event was read from, capped the same way. Default false.'),
  },
  { error: 'expected an object' },
)
export const reconstructInput = z.strictObject({ traceId, eventId }, { error: 'expected an object' })

/** The JSON Schema a tool advertises for `schema`: the parse schema's input side, without the `$schema` key. */
export function inputJsonSchema(schema: z.ZodMiniType): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: 'input' })
  return rest
}

/** `input` parsed by `schema`, or a `TypeError` naming the tool, the field, and what it expects. */
export function parseToolInput<T extends z.ZodMiniType>(tool: string, schema: T, input: unknown): z.output<T> {
  const parsed = z.safeParse(schema, input ?? {})
  if (parsed.success) {
    return parsed.data
  }
  const issue = parsed.error.issues[0]
  if (issue?.code === 'unrecognized_keys') {
    const keys = issue.keys.slice(0, 5).map(key => JSON.stringify(key.slice(0, 64)))
    throw new TypeError(`${tool}: unknown argument ${keys.join(', ')}`)
  }
  const field = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  throw new TypeError(`${tool}: ${field}${issue?.message ?? 'invalid input'}`)
}
