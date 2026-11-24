import type { ReportFunctions, ServerFunctions, SessionPublisher, SessionsSignal } from '@rivus/estela-rpc'
import { defineDevframe, type DevframeDefinition, type DevframeNodeContext } from 'devframe'
import { emptySessionsSignal, NAMESPACE, SESSIONS_STATE } from '@rivus/estela-rpc'

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
 * functions it is given, runs `services.setup` to load and register agent tools, and binds the
 * instance's session publisher to DevFrame shared state.
 * In `build` mode (a report) it registers the functions only: "Export report" runs a build inside
 * the dev server, whose shared state must stay undisturbed.
 */
export function defineEstela(
  app: EstelaApp,
  functions: ServerFunctions,
  report: ReportFunctions,
  services: {
    publisher: SessionPublisher
    setup: (ctx: DevframeNodeContext) => Promise<void>
  },
): DevframeDefinition {
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
    // The range makes DevFrame try the following ports in order when 7392 is taken; without it a
    // taken default falls back to a random port.
    cli: { port: 7392, portRange: [7392, 7491] },
    async setup(ctx: DevframeNodeContext) {
      const scoped = ctx.scope(NAMESPACE)
      for (const fn of functions) {
        scoped.rpc.register(fn)
      }
      if (ctx.mode === 'build') {
        // A report: DevFrame bakes the argument-free `report-trace` snapshot. No browser is
        // connected to a build, and "Export report" runs a build inside the dev server, so the
        // session push below must stay bound to the live server's state.
        for (const fn of report) {
          scoped.rpc.register(fn)
        }
        return
      }
      await services.setup(ctx)
      // Push: a small shared state tells every browser that rows changed. The browser then
      // asks `list-sessions({ since })` for only those rows.
      void scoped.rpc
        .sharedState<SessionsSignal>(SESSIONS_STATE, { initialValue: emptySessionsSignal() })
        .then(state => {
          services.publisher.bind(next => {
            state.mutate(draft => {
              draft.revision = next.revision
              draft.pending = next.pending
            })
          })
        })
    },
  })
}
