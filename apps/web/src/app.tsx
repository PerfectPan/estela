import type { ReportTrace } from '@rivus/estela-rpc'
import { Match, Switch } from 'solid-js'
import { SessionBrowser } from '@/browser/session-browser.tsx'
import { useRoute } from '@/shell/router.ts'
import { Workspace } from '@/workspace/workspace.tsx'

/** Hash routes: `#/` is the session browser, `#/s/<traceId>` the workspace. A report shows only its one session. */
export function App(props: { report?: ReportTrace }) {
  const route = useRoute()
  const workspaceTraceId = () => {
    const current = route()
    return current.name === 'workspace' ? current.traceId : undefined
  }
  return (
    <Switch>
      <Match when={props.report}>{report => <Workspace traceId="" report={report()} />}</Match>
      <Match when={workspaceTraceId()} keyed>
        {traceId => <Workspace traceId={traceId} />}
      </Match>
      <Match when={route().name === 'browser'}>
        <SessionBrowser />
      </Match>
    </Switch>
  )
}
