import type { SessionsSignal } from '@rivus/estela-rpc'
import { defineDevframe, type DevframeDefinition, type DevframeNodeContext } from 'devframe'
import {
  bindSessionPublisher,
  emptySessionsSignal,
  NAMESPACE,
  reportFunctions,
  serverFunctions,
  SESSIONS_STATE,
} from '@rivus/estela-rpc'

export const BASE_PATH = '/__estela/'

/** What the shipped package says about itself, and where its built SPA is. */
export interface EstelaApp {
  packageName: string
  version: string
  homepage: string
  description: string
  /** The built SPA directory, absolute. */
  clientAssets: string
}

/**
 * The DevFrame definition. In `dev` mode (the dev server, `mcp`, a hub) `setup` registers the
 * functions, runs `services` to build and bind what they call, and publishes the session signal.
 * In `build` mode (a report) it registers the functions only: "Export report" runs a build inside
 * the dev server, whose services must stay bound.
 */
export function defineEstela(app: EstelaApp, services: () => Promise<void>): DevframeDefinition {
  return defineDevframe({
    id: 'estela',
    name: 'Estela',
    version: app.version,
    packageName: app.packageName,
    importMetaUrl: import.meta.url,
    homepage: app.homepage,
    description: app.description,
    icon: 'ph:path-duotone',
    basePath: BASE_PATH,
    clientAssets: app.clientAssets,
    // The dev server's default port; the CLI's own route table owns every option.
    cli: { port: 7392 },
    async setup(ctx: DevframeNodeContext) {
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
      await services()
      // Push: a small shared state tells every browser that rows changed. The browser then
      // asks `list-sessions({ since })` for only those rows.
      void scoped.rpc
        .sharedState<SessionsSignal>(SESSIONS_STATE, { initialValue: emptySessionsSignal() })
        .then(state => {
          bindSessionPublisher(next => {
            state.mutate(draft => {
              draft.revision = next.revision
              draft.pending = next.pending
            })
          })
        })
    },
  })
}
