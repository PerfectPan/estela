import type { ReportTrace } from '@rivus/agent-trace-rpc'
import { Match, Show, Switch } from 'solid-js'
import { escapeBidi } from '@/lib/preview.ts'
import { connectionLost } from '@/shell/connection.ts'
import { ConnectionLost } from '@/shell/connection-lost.tsx'
import { TopBar } from '@/shell/top-bar.tsx'
import { ExportReport } from './export-report.tsx'
import { LoadingPanel } from './load-screen.tsx'
import { ErrorPanel } from './error-panel.tsx'
import { createSessionLoad, reportSession } from './load-session.ts'
import { ReportBanner } from './report-banner.tsx'
import { SessionView } from './session-view.tsx'

/**
 * `#/s/<traceId>`: load with progress, then header, timeline, ledger, and inspector.
 * With a `report`, the same view over the baked session: no load, no export, no server calls.
 */
export function Workspace(props: { traceId: string; report?: ReportTrace }) {
  const report = props.report
  const baked = report ? ({ status: 'ready', session: reportSession(report) } as const) : undefined
  const load = baked ? { state: () => baked, retry: () => {} } : createSessionLoad(props.traceId)
  const ready = () => {
    const state = load.state()
    return state.status === 'ready' ? state.session : undefined
  }
  const loading = () => {
    const state = load.state()
    return state.status === 'loading' ? state : undefined
  }
  const failure = () => {
    const state = load.state()
    return state.status === 'error' ? state.failure : undefined
  }
  const crumbs = () => {
    const session = ready()?.trace.session
    const project = session?.cwd?.split('/').filter(Boolean).pop()
    return [project, session?.title].filter((part): part is string => Boolean(part)).map(escapeBidi)
  }
  return (
    <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TopBar
        crumbs={crumbs()}
        report={report !== undefined}
        actions={ready() && !report ? <ExportReport traceId={props.traceId} /> : undefined}
        onJump={() => document.querySelector<HTMLElement>('[data-testid="ledger"]')?.focus()}
      />
      <Switch>
        <Match when={loading()}>
          {progress => <LoadingPanel bytesRead={progress().bytesRead} totalBytes={progress().totalBytes} />}
        </Match>
        <Match when={failure()}>{current => <ErrorPanel failure={current()} onRetry={load.retry} />}</Match>
        <Match when={ready()} keyed>
          {session => (
            <>
              {/* A loaded view stays readable after a drop; `get-event` would fail, so say so. */}
              <Show when={!report && connectionLost()}>
                <ConnectionLost compact />
              </Show>
              <Show when={report}>{current => <ReportBanner report={current()} />}</Show>
              <SessionView session={session} report={report !== undefined} />
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
