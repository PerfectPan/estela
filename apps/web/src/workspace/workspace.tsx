import type { ReportTrace } from '@rivus/estela-rpc'
import type { JSX } from 'solid-js'
import type { LoadClient } from './load-session.ts'
import { Match, Show, Switch, onCleanup, onMount } from 'solid-js'
import { locale } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { escapeBidi } from '@/lib/preview.ts'
import { ConnectionLost } from '@/shell/connection-lost.tsx'
import { TopBar } from '@/shell/top-bar.tsx'
import { LoadingPanel } from './load-screen.tsx'
import { ErrorPanel } from './error-panel.tsx'
import { createSessionLoad, reportSession } from './load-session.ts'
import { ReportBanner } from './report-banner.tsx'
import { SessionView } from './session-view.tsx'

type WorkspaceProps = (
  | { report: ReportTrace; connect?: undefined }
  | { report?: undefined; connect: () => Promise<LoadClient> }
) & {
  traceId: string
  /** Reactive connection-lost state for a live host; omitted when the host has none. */
  lost?: () => boolean
  /** Element drawn in the top bar once the session is ready (for example "Export report"); omitted when absent. */
  export?: JSX.Element
  /** Embedded inside a shadow root: no `#/` links, switches, or `location.reload()`. */
  embedded?: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * `#/s/<traceId>`: load with progress, then header, timeline, ledger, and inspector.
 * With a `report`, the same view over the baked session: no load, no export, no server calls.
 */
export function Workspace(props: WorkspaceProps) {
  const report = props.report
  let root: HTMLDivElement | undefined
  const focusLedger = () => root?.querySelector<HTMLElement>('[data-testid="ledger"]')?.focus()

  // ⌘K / Ctrl+K focuses the ledger while this workspace is mounted, without stealing typing from host inputs.
  onMount(() => {
    const owner = root?.ownerDocument ?? (typeof document === 'undefined' ? undefined : document)
    if (!owner) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k') {
        return
      }
      if (!root?.isConnected || root.closest('[hidden]') !== null) {
        return
      }
      const target = event.composedPath()[0] ?? event.target
      if (isEditableTarget(target)) {
        return
      }
      const ledger = root.querySelector<HTMLElement>('[data-testid="ledger"]')
      if (!ledger) {
        return
      }
      event.preventDefault()
      ledger.focus()
    }
    owner.addEventListener('keydown', onKeyDown)
    onCleanup(() => owner.removeEventListener('keydown', onKeyDown))
  })

  const baked = report ? ({ status: 'ready', session: reportSession(report) } as const) : undefined
  const load = baked
    ? { state: () => baked, retry: () => {} }
    : createSessionLoad(props.traceId, props.connect!, { failOnEventError: props.embedded })
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
    <div
      ref={element => {
        root = element
      }}
      lang={locale()}
      class={cx(
        'flex h-full min-h-0 flex-col bg-background text-foreground',
        props.embedded && 'border-b border-border',
      )}
    >
      <Show when={!props.embedded}>
        <TopBar
          crumbs={crumbs()}
          report={report !== undefined}
          actions={ready() && !report ? props.export : undefined}
          onJump={focusLedger}
        />
      </Show>
      <Switch>
        <Match when={loading()}>
          {progress => <LoadingPanel bytesRead={progress().bytesRead} totalBytes={progress().totalBytes} />}
        </Match>
        <Match when={failure()}>
          {current => <ErrorPanel failure={current()} onRetry={load.retry} embedded={props.embedded} />}
        </Match>
        <Match when={ready()} keyed>
          {session => (
            <>
              {/* A loaded view stays readable after a drop; `get-event` would fail, so say so. */}
              <Show when={!report && props.lost?.()}>
                <ConnectionLost compact />
              </Show>
              <Show when={report}>{current => <ReportBanner report={current()} />}</Show>
              <SessionView
                session={session}
                report={report !== undefined}
                embedded={props.embedded}
                onJump={focusLedger}
              />
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
