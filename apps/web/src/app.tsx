import { Match, Switch, createResource } from 'solid-js'
import { SessionBrowser } from '@/browser/session-browser.tsx'
import { isStaticBuild } from '@/shell/client.ts'
import { useRoute } from '@/shell/router.ts'
import { Workspace } from '@/workspace/workspace.tsx'

/** Hash routes: `#/` is the session browser, `#/s/<ref>` the workspace. A static build shows its one trace. */
export function App() {
  const route = useRoute()
  const [staticBuild] = createResource(isStaticBuild)
  const workspaceRef = () => {
    const current = route()
    return current.name === 'workspace' ? current.ref : undefined
  }
  return (
    <Switch>
      <Match when={staticBuild.loading}>{null}</Match>
      <Match when={staticBuild()}>
        <Workspace sessionRef="" />
      </Match>
      <Match when={workspaceRef()} keyed>
        {ref => <Workspace sessionRef={ref} />}
      </Match>
      <Match when={route().name === 'browser'}>
        <SessionBrowser />
      </Match>
    </Switch>
  )
}
