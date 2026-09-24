import type { LoadedSession } from './load-session.ts'
import { Match, Show, Switch } from 'solid-js'
import { ExportIcon } from '@/components/icons.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'
import { TopBar } from '@/shell/top-bar.tsx'
import { Inspector } from './inspector/inspector.tsx'
import { Ledger } from './ledger/ledger.tsx'
import { ErrorPanel, LoadingPanel } from './load-screen.tsx'
import { createSessionLoad } from './load-session.ts'
import { SessionHeader } from './session-header.tsx'
import { Timeline } from './timeline/timeline.tsx'
import { createWorkspaceState } from './workspace-state.ts'

/** The default string cap of the view trace (`toView`); a lower cap means `fitView` shortened more to fit 12 MB. */
const DEFAULT_MAX_STRING = 4096

/** `#/s/<ref>`: load with progress, then header, timeline, ledger, and inspector (plan 3.6). */
export function Workspace(props: { sessionRef: string }) {
  const load = createSessionLoad(props.sessionRef)
  const ready = () => {
    const state = load.state()
    return state.status === 'ready' ? state.session : undefined
  }
  const crumbs = () => {
    const session = ready()?.trace.session
    const project = session?.cwd?.split('/').filter(Boolean).pop()
    return [project, session?.title].filter((part): part is string => Boolean(part))
  }
  const exportButton = (
    <button
      type="button"
      aria-disabled="true"
      title={t('workspace.exportLater')}
      class="flex h-8 cursor-not-allowed items-center gap-[7px] rounded-lg border border-input px-3 text-[13px] whitespace-nowrap text-foreground opacity-60"
      data-testid="export-report"
    >
      <ExportIcon />
      {t('report.export')}
    </button>
  )
  return (
    <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TopBar crumbs={crumbs()} actions={ready() ? exportButton : undefined} onJump={() => document.querySelector<HTMLElement>('[data-testid="ledger"]')?.focus()} />
      <Switch>
        <Match when={load.state().status === 'loading' && load.state()}>
          {state => {
            const progress = () => state() as { bytesRead: number, totalBytes: number }
            return <LoadingPanel bytesRead={progress().bytesRead} totalBytes={progress().totalBytes} />
          }}
        </Match>
        <Match when={load.state().status === 'error' && load.state()}>
          {state => <ErrorPanel failure={(state() as Extract<ReturnType<typeof load.state>, { status: 'error' }>).failure} onRetry={load.retry} />}
        </Match>
        <Match when={ready()} keyed>
          {session => <SessionView session={session} />}
        </Match>
      </Switch>
    </div>
  )
}

function SessionView(props: { session: LoadedSession }) {
  const state = createWorkspaceState(props.session)
  const view = () => props.session.trace.view
  const start = state.timeline.start
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <SessionHeader trace={props.session.trace} summary={props.session.summary} />
      <Show when={view() && (view()!.withinBudget === false || view()!.maxString < DEFAULT_MAX_STRING)}>
        <p class="m-0 shrink-0 border-b border-border bg-secondary px-5 py-1.5 text-[12px] text-muted-foreground" data-testid="view-notice">
          {view()!.withinBudget === false
            ? t('workspace.overBudget')
            : t('workspace.cappedNotice', { count: formatNumber(view()!.maxString, locale()) })}
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
