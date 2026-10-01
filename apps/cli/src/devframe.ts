import type { SessionsSignal } from '@rivus/agent-trace-rpc'
import { defineDevframe } from 'devframe'
import {
  bindSessionPublisher,
  emptySessionsSignal,
  NAMESPACE,
  reportFunctions,
  serverFunctions,
  SESSIONS_STATE,
} from '@rivus/agent-trace-rpc'
import pkg from '../package.json' with { type: 'json' }
import { webDistDir } from './paths.ts'

export const BASE_PATH = '/__agent-trace/'

export default defineDevframe({
  id: 'agent-trace',
  name: 'Agent Trace',
  version: pkg.version,
  packageName: pkg.name,
  importMetaUrl: import.meta.url,
  homepage: pkg.homepage,
  description: pkg.description ?? 'Inspect agent session logs; reconstruct what the model saw.',
  icon: 'ph:path-duotone',
  basePath: BASE_PATH,
  clientAssets: webDistDir(),
  cli: {
    command: 'agent-trace',
    port: 7392,
    configure(cli) {
      cli.option('--pick', 'Pick a session in the terminal')
      cli.option('--no-index', 'Do not read or write the session index')
    },
  },
  setup(ctx) {
    const scoped = ctx.scope(NAMESPACE)
    for (const fn of serverFunctions) {
      scoped.rpc.register(fn)
    }
    if (ctx.mode === 'build') {
      // A report: DevFrame bakes the argument-free `report-trace` snapshot. No browser is
      // connected to a build, and "Export report" runs a build inside the dev server, so the
      // session push below must stay bound to the live server's state.
      for (const fn of reportFunctions) {
        scoped.rpc.register(fn)
      }
      return
    }
    // Push: a small shared state tells every browser that rows changed. The browser then
    // asks `list-sessions({ since })` for only those rows (M3 report: push vs poll).
    void scoped.rpc.sharedState<SessionsSignal>(SESSIONS_STATE, { initialValue: emptySessionsSignal() }).then(state => {
      bindSessionPublisher(next => {
        state.mutate(draft => {
          draft.revision = next.revision
          draft.pending = next.pending
        })
      })
    })
  },
})
