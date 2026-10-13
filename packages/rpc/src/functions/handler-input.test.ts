import type { ListSessionsQuery } from '../list-types.ts'
import type { ExportReportInput } from './report.ts'
import { describe, expect, it } from 'vite-plus/test'
import { fixture, storeOf } from '../../testing/store-fixture.ts'
import { listSessions } from './list-sessions.ts'
import { bindReportExporter, exportReport } from './report.ts'
import { bindSessionService } from './service.ts'
import { bindTraceStore, getEvent, getTraceView, loadTrace, reconstructAt } from './trace-view.ts'

type WireHandler = (input?: unknown) => Promise<unknown>

/**
 * The handler as DevFrame calls it, with whatever the client sent; the parameter types promise more than the wire
 * does. A test double: the context carries only what the handlers read.
 */
async function wire(definition: { setup?: unknown }): Promise<WireHandler> {
  const setup = definition.setup as (context: unknown) => Promise<{ handler: WireHandler }>
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
    [{ first: 'a' }, 'list-sessions: first must be an array of at most 500 refs'],
    [{ first: [1] }, 'list-sessions: first must be an array of at most 500 refs'],
    [{ first: Array.from({ length: 501 }, () => 'a') }, 'list-sessions: first must be an array of at most 500 refs'],
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
    await handler({ ref: 'r', locale: 'zh-CN' })
    await handler({ ref: 'r', locale: 'fr' })
    expect(seen).toEqual([
      { ref: 'r', locale: 'zh-CN' },
      { ref: 'r', locale: undefined },
    ])
  })

  it.each([undefined, null, 'r', {}, { ref: '' }, { ref: 1 }])('refuses %j without a session ref', async input => {
    const handler = await wire(exportReport)
    await expect(handler(input)).rejects.toEqual(new Error('export-report needs a session ref'))
  })
})

describe('trace handler input', () => {
  const f = fixture()
  f.write('/logs/a.jsonl', [{ id: 'e1', kind: 'user', text: 'hi' }])
  f.write('/logs/current.jsonl', [{ id: 'e1', kind: 'user', text: 'launch' }])
  const { store } = storeOf({ fs: f.fs, parse: f.parse })
  bindTraceStore(store)

  it.each([
    [loadTrace, undefined, 'load-trace needs a session ref'],
    [loadTrace, { ref: 1 }, 'load-trace needs a session ref'],
    [getTraceView, {}, 'get-trace-view needs a session ref'],
    [getEvent, null, 'get-event needs a session ref and an event id'],
    [getEvent, { id: 'e1' }, 'get-event needs a session ref'],
    [getEvent, { ref: 'a', id: 1 }, 'get-event needs an event id'],
    [reconstructAt, {}, 'reconstruct needs an event id'],
    [
      reconstructAt,
      { ref: 1, eventId: 'e1' },
      'reconstruct: ref must be a string; leave it out for the current session',
    ],
  ])('%#: refuses %j', async (definition, input, message) => {
    const handler = await wire(definition)
    await expect(handler(input)).rejects.toEqual(new TypeError(message))
  })

  it('passes any string ref to the store, which names the unknown one', async () => {
    const handler = await wire(getEvent)
    await expect(handler({ ref: 'missing', id: 'e1' })).rejects.toThrow('unknown session ref: missing')
    await expect(handler({ ref: 'a', id: 'nope' })).rejects.toThrow('no event nope in a')
  })

  it('reconstructs the launch session when MCP leaves the ref out or null', async () => {
    const handler = await wire(reconstructAt)
    await expect(handler({ eventId: 'e1' })).resolves.toMatchObject({ eventId: 'e1', visibleIds: ['e1'] })
    await expect(handler({ ref: null, eventId: 'e1' })).resolves.toMatchObject({ eventId: 'e1', visibleIds: ['e1'] })
  })
})
