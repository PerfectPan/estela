import type { LoadedSession } from './load-session.ts'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { compareChoices, compareTarget } from '@/lib/context-compare.ts'
import { formatNumber } from '@/lib/format.ts'
import { Inspector } from './inspector/inspector.tsx'
import { Ledger } from './ledger/ledger.tsx'
import { SessionHeader } from './session-header.tsx'
import { Timeline } from './timeline/timeline.tsx'
import { createWorkspaceState } from './workspace-state.ts'

/** The default string cap of the view trace (`toView`); a lower cap means `fitView` shortened more to fit 12 MB. */
const DEFAULT_MAX_STRING = 4096

export function SessionView(props: {
  session: LoadedSession
  report: boolean
  embedded?: boolean
  onJump?: () => void
}) {
  const state = createWorkspaceState(props.session)
  const view = () => props.session.trace.view
  const start = state.timeline.start
  /** The compared request while the Compare tab is open, so the ring and the tab say the same thing. */
  const compareId = () => {
    const selected = state.selectedEventId()
    return selected && state.tab() === 'compare'
      ? compareTarget(compareChoices(state.model, selected), state.comparePick())
      : undefined
  }
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <SessionHeader
        trace={props.session.trace}
        summary={props.session.summary}
        cost={state.cost}
        embedded={props.embedded}
        onJump={props.onJump}
      />
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
        compareId={compareId()}
        onCompare={state.compareWith}
      />
      <div class="flex min-h-0 flex-1">
        <Ledger state={state} start={start} embedded={props.embedded} />
        <Inspector state={state} start={start} embedded={props.embedded} />
      </div>
    </div>
  )
}
