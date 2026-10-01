import type { ReportTrace } from '@rivus/agent-trace-rpc'
import type { LoadedSession } from './load-session.ts'
import { Match, Show, Switch } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'
import { escapeBidi } from '@/lib/preview.ts'
import { connectionLost } from '@/shell/connection.ts'
import { ConnectionLost } from '@/shell/connection-lost.tsx'
import { TopBar } from '@/shell/top-bar.tsx'
import { ExportReport } from './export-report.tsx'
import { Inspector } from './inspector/inspector.tsx'
import { Ledger } from './ledger/ledger.tsx'
import { ErrorPanel, LoadingPanel } from './load-screen.tsx'
import { createSessionLoad, reportSession } from './load-session.ts'
import { SessionHeader } from './session-header.tsx'
import { Timeline } from './timeline/timeline.tsx'
import { createWorkspaceState } from './workspace-state.ts'

/** The default string cap of the view trace (`toView`); a lower cap means `fitView` shortened more to fit 12 MB. */
const DEFAULT_MAX_STRING = 4096

/**
 * `#/s/<ref>`: load with progress, then header, timeline, ledger, and inspector (plan 3.6).
 * With a `report`, the same view over the baked session: no load, no export, no server calls.
 */
export function Workspace(props: { sessionRef: string; report?: ReportTrace }) {
  const report = props.report
  const baked = report ? ({ status: 'ready', session: reportSession(report) } as const) : undefined
  const load = baked ? { state: () => baked, retry: () => {} } : createSessionLoad(props.sessionRef)
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
        actions={ready() && !report ? <ExportReport sessionRef={props.sessionRef} /> : undefined}
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

/** Report mode (plan 3.9): what the redaction did and did not remove, and how many originals are included. */
function ReportBanner(props: { report: ReportTrace }) {
  return (
    <div
      class="flex shrink-0 flex-col gap-0.5 border-b border-border bg-secondary px-5 py-1.5 text-[12px] text-muted-foreground"
      role="note"
      data-testid="report-banner"
    >
      <span>{t('report.banner')}</span>
      <Show when={props.report.truncated}>
        <span data-testid="report-truncated">
          {t('report.truncated', {
            included: formatNumber(props.report.events.length, locale()),
            total: formatNumber(props.report.total, locale()),
          })}
        </span>
      </Show>
    </div>
  )
}

function SessionView(props: { session: LoadedSession; report: boolean }) {
  const state = createWorkspaceState(props.session)
  const view = () => props.session.trace.view
  const start = state.timeline.start
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <SessionHeader trace={props.session.trace} summary={props.session.summary} />
      <Show when={view() && (view()!.withinBudget === false || view()!.maxString < DEFAULT_MAX_STRING)}>
        <p
          class="m-0 shrink-0 border-b border-border bg-secondary px-5 py-1.5 text-[12px] text-muted-foreground"
          data-testid="view-notice"
        >
          {view()!.withinBudget === false
            ? t('workspace.overBudget')
            : t(props.report ? 'report.cappedNotice' : 'workspace.cappedNotice', {
                count: formatNumber(view()!.maxString, locale()),
              })}
        </p>
      </Show>
      <Timeline
        data={state.timeline}
        range={state.range()}
        onRange={state.setRange}
        count={state.eventCount()}
        selectedId={state.selectedEventId()}
        onSelect={state.reveal}
      />
      <div class="flex min-h-0 flex-1">
        <Ledger state={state} start={start} />
        <Inspector state={state} start={start} />
      </div>
    </div>
  )
}
