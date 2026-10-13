import type { ListSessionsQuery } from '../list-types.ts'
import type { ExportReportInput } from './report.ts'
import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { fixture, storeOf } from '../../testing/store-fixture.ts'
import { listSessions } from './list-sessions.ts'
import { bindReportExporter, exportReport } from './report.ts'
import { bindSessionService } from './service.ts'
import { bindTraceStore, getEvent, getTraceView, loadTrace, reconstructAt } from './trace-view.ts'

/**
 * A definition's `setup` read as DevFrame runs it: its handler takes whatever the client sent, since the parameter
 * types promise more than the wire does. The context is a test double carrying only what the handlers read.
 */
const wireSetup = z.function({
  input: [z.unknown()],
  output: z.promise(
    z.object({ handler: z.function({ input: [z.optional(z.unknown())], output: z.promise(z.unknown()) }) }),
  ),
})

async function wire(definition: { setup?: unknown }) {
  const setup = z.parse(wireSetup, definition.setup)
  const owner = {}
  return (await setup({ rpc: { getCurrentRpcSession: () => ({ meta: owner }) } })).handler
}

describe('list-sessions input', () => {
  const seen: ListSessionsQuery[] = []
  bindSessionService({
    listSessions: async query => {
      seen.push(query)
      return { agents: [], rows: [], complete: true, pending: 0, revision: 0 }
    },
  })

  it('reads no input as no options and drops unknown keys', async () => {
    const handler = await wire(listSessions)
    seen.length = 0
    await handler()
    await handler(null)
    await handler({ query: 'auth', since: 3, first: ['a'], extra: true })
    expect(seen).toEqual([{}, {}, { query: 'auth', since: 3, first: ['a'] }])
  })

  it.each([
    [[], 'list-sessions: expected an object'],
    ['auth', 'list-sessions: expected an object'],
    [{ query: 1 }, 'list-sessions: query must be a string of at most 1000 characters'],
    [{ query: 'a'.repeat(1001) }, 'list-sessions: query must be a string of at most 1000 characters'],
    [{ since: 1.5 }, 'list-sessions: since must be a non-negative integer'],
    [{ since: -1 }, 'list-sessions: since must be a non-negative integer'],
    [{ since: '3' }, 'list-sessions: since must be a non-negative integer'],
    [{ first: 'a' }, 'list-sessions: first must be an array of at most 500 trace ids'],
    [{ first: [1] }, 'list-sessions: first must be an array of at most 500 trace ids'],
    [
      { first: Array.from({ length: 501 }, () => 'a') },
      'list-sessions: first must be an array of at most 500 trace ids',
    ],
    [{ query: 1, since: -1 }, 'list-sessions: query must be a string of at most 1000 characters'],
  ])('refuses %j with the message the browser shows', async (input, message) => {
    const handler = await wire(listSessions)
    await expect(handler(input)).rejects.toEqual(new TypeError(message))
  })
})

describe('export-report input', () => {
  const seen: ExportReportInput[] = []
  bindReportExporter(async input => {
    seen.push(input)
    return { path: '~/report/index.html', included: 0, total: 0 }
  })

  it('ignores a locale it does not know', async () => {
    const handler = await wire(exportReport)
    seen.length = 0
    await handler({ traceId: 'r', locale: 'zh-CN' })
    await handler({ traceId: 'r', locale: 'fr' })
    expect(seen).toEqual([
      { traceId: 'r', locale: 'zh-CN' },
      { traceId: 'r', locale: undefined },
    ])
  })

  it.each([undefined, null, 'r', {}, { traceId: '' }, { traceId: 1 }])('refuses %j without a trace id', async input => {
    const handler = await wire(exportReport)
    await expect(handler(input)).rejects.toEqual(new Error('export-report needs a trace id'))
  })
})

describe('trace handler input', () => {
  const f = fixture()
  f.write('/logs/a.jsonl', [{ id: 'e1', kind: 'user', text: 'hi' }])
  f.write('/logs/current.jsonl', [{ id: 'e1', kind: 'user', text: 'launch' }])
  const { store } = storeOf({ fs: f.fs, parse: f.parse })
  bindTraceStore(store)

  it.each([
    [loadTrace, undefined, 'load-trace needs a trace id'],
    [loadTrace, { traceId: 1 }, 'load-trace needs a trace id'],
    [getTraceView, {}, 'get-trace-view needs a trace id'],
    [getEvent, null, 'get-event needs a trace id and an event id'],
    [getEvent, { id: 'e1' }, 'get-event needs a trace id'],
    [getEvent, { traceId: 'a', id: 1 }, 'get-event needs an event id'],
    [reconstructAt, {}, 'reconstruct needs an event id'],
    [
      reconstructAt,
      { traceId: 1, eventId: 'e1' },
      'reconstruct: traceId must be a string; leave it out for the current session',
    ],
  ])('%#: refuses %j', async (definition, input, message) => {
    const handler = await wire(definition)
    await expect(handler(input)).rejects.toEqual(new TypeError(message))
  })

  it('passes any string trace id to the store, which names the unknown one', async () => {
    const handler = await wire(getEvent)
    await expect(handler({ traceId: 'missing', id: 'e1' })).rejects.toThrow('unknown trace id: missing')
    await expect(handler({ traceId: 'a', id: 'nope' })).rejects.toThrow('no event nope in a')
  })

  it('reconstructs the launch session when MCP leaves the traceId out or null', async () => {
    const handler = await wire(reconstructAt)
    await expect(handler({ eventId: 'e1' })).resolves.toMatchObject({ eventId: 'e1', visibleIds: ['e1'] })
    await expect(handler({ traceId: null, eventId: 'e1' })).resolves.toMatchObject({
      eventId: 'e1',
      visibleIds: ['e1'],
    })
  })
})
