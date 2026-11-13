import type { JSX } from 'solid-js'
import type { Entry, RowKind } from '@/lib/ledger-model.ts'
import type { SessionEvent } from '../load-session.ts'
import type { WorkspaceState } from '../workspace-state.ts'
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from 'solid-js'
import { CloseIcon } from '@/components/icons.tsx'
import { KIND_TITLE } from '@/components/kind-mark.tsx'
import { KindSquare } from '@/components/kind-square.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { exitCode, isShortened, pretty, toolName } from '@/lib/event-text.ts'
import { messageOf } from '@/lib/error-message.ts'
import { createEventCache, rawFetchKey } from '@/lib/event-cache.ts'
import { elapsedFrom, formatDuration, formatTokens } from '@/lib/format.ts'
import { costBasisText, priceVersionText, requestCostDetail, requestCostText } from '@/lib/cost-text.ts'
import { ContextCompare } from './context-compare.tsx'
import { INSPECTOR_TABS, type InspectorTab } from './inspector-tab.ts'
import { ModelSaw } from './model-saw.tsx'
import { inputText, outputText } from './tab-text.ts'
import { TextView } from './text-view.tsx'

function entryKind(entry: Entry): RowKind {
  switch (entry.type) {
    case 'event':
      return entry.kind
    case 'hooks':
      return 'hook'
    case 'compaction':
      return 'compaction'
    case 'subagent':
      return 'subagent'
  }
}

function entryOrdinal(entry: Entry): number | undefined {
  return entry.type === 'event' || entry.type === 'subagent' ? entry.ordinal || undefined : undefined
}

const tabId = (id: InspectorTab) => `inspector-tab-${id}`
const panelId = (id: InspectorTab) => `inspector-panel-${id}`

/**
 * Inspector (470 px): Input, Output, Model saw, Compare, Raw. A shortened event (S12) loads its full
 * text through `get-event` on selection; "Raw" shows the pretty-printed original record.
 * Each tab panel is built the first time it is opened and then only hidden, so switching
 * tabs does not draw a large text again.
 */
export function Inspector(props: { state: WorkspaceState; start: number }) {
  const state = props.state
  const tab = state.tab
  const [visited, setVisited] = createSignal<ReadonlySet<InspectorTab>>(new Set([tab()]))
  // The timeline can open a tab too (Shift-click opens Compare), so a panel is built when its tab first shows.
  createEffect(() => {
    const current = tab()
    if (!visited().has(current)) {
      setVisited(new Set([...visited(), current]))
    }
  })
  const fetchEvent = createEventCache(id => state.session.event(id))
  function choose(next: InspectorTab): void {
    state.setTab(next)
  }
  function onTabKey(event: KeyboardEvent): void {
    const at = INSPECTOR_TABS.findIndex(item => item.id === tab())
    const next =
      event.key === 'ArrowRight'
        ? (at + 1) % INSPECTOR_TABS.length
        : event.key === 'ArrowLeft'
          ? (at + INSPECTOR_TABS.length - 1) % INSPECTOR_TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? INSPECTOR_TABS.length - 1
              : -1
    if (next < 0) {
      return
    }
    event.preventDefault()
    choose(INSPECTOR_TABS[next]!.id)
    document.getElementById(tabId(INSPECTOR_TABS[next]!.id))?.focus()
  }

  const entry = () => state.selectedEntry()
  const primaryId = state.selectedEventId
  const resultId = () => {
    const current = entry()
    return current && (current.type === 'event' || current.type === 'subagent') ? current.resultId : undefined
  }
  const ids = createMemo(() => [primaryId(), resultId()].filter((id): id is string => id !== undefined))
  const shortenedIds = createMemo(() => ids().filter(id => isShortened(state.model.byId.get(id))))
  const [full] = createResource(
    () => (shortenedIds().length > 0 ? shortenedIds().join('\0') : undefined),
    async key => new Map((await Promise.all(key.split('\0').map(fetchEvent))).map(event => [event.id, event])),
  )
  const [raw] = createResource(
    // Only while Raw is open; a hidden Raw panel keeps its last result and fetches nothing.
    () => rawFetchKey(tab(), ids()),
    key => Promise.all(key.split('\0').map(fetchEvent)),
  )
  const lookup = (id: string) => (full.state === 'ready' ? full().get(id) : undefined) ?? state.model.byId.get(id)
  const primary = () => (primaryId() ? lookup(primaryId()!) : undefined)
  const result = () => (resultId() ? lookup(resultId()!) : undefined)
  const input = createMemo(() => (entry() ? inputText(entry()!, primary(), lookup) : ''))
  const output = createMemo(() => (entry() ? outputText(entry()!, primary(), result(), state.model, lookup) : ''))

  const title = () => {
    const current = entry()
    if (!current) {
      return ''
    }
    const ordinal = entryOrdinal(current)
    return `${t(KIND_TITLE[entryKind(current)])}${ordinal ? ` #${ordinal}` : ''}`
  }
  /** The cost of the selected row when it is a `request` event. */
  const requestCost = createMemo(() => state.cost.requests.get(primaryId() ?? ''))
  const costLine = createMemo(() => {
    const cost = requestCost()
    if (!cost) {
      return undefined
    }
    const head = cost.kind === 'priced' ? requestCostDetail(cost) : [requestCostText(cost), ...requestCostDetail(cost)]
    return [...head, priceVersionText(state.cost.version)]
  })
  const meta = createMemo((): string[] => {
    const event = state.model.byId.get(primaryId() ?? '')
    if (!event) {
      return []
    }
    const request = state.model.requests.get(event.id)?.entry
    if (request) {
      const finishReason = event.kind === 'request' ? event.payload.finishReason : undefined
      return [
        request.model ?? '',
        request.inputTokens !== undefined ? t('inspector.inTokens', { value: formatTokens(request.inputTokens) }) : '',
        request.outputTokens !== undefined
          ? t('inspector.outTokens', { value: formatTokens(request.outputTokens) })
          : '',
        request.durationMs !== undefined ? formatDuration(request.durationMs, locale()) : '',
        finishReason ? t('common.finishReason', { reason: finishReason }) : '',
        requestCost()?.kind === 'priced' ? requestCostText(requestCost()!) : '',
      ].filter(Boolean)
    }
    const at = elapsedFrom(event.ts, props.start)
    if (event.kind === 'tool_call') {
      const code = exitCode(state.model.byId.get(resultId() ?? ''))
      return [toolName(event), code !== undefined ? t('ledger.exit', { code }) : '', at].filter(Boolean)
    }
    return [at].filter(Boolean)
  })
  const notice = () => {
    if (shortenedIds().length === 0) {
      return undefined
    }
    if (full.state === 'errored') {
      return t('inspector.shortenedFailed', { reason: messageOf(full.error) })
    }
    if (full.state !== 'ready') {
      return t('inspector.shortenedLoading')
    }
    return [...full().values()].some(event => event.notInReport)
      ? t('report.fullNotIncluded')
      : t('inspector.shortenedLoaded')
  }
  const sourceOf = (event: SessionEvent) => {
    const file = state.session.trace.sourceFiles?.[Number(event.source.file)] ?? event.source.file
    return `${file}:${event.source.line}`
  }

  function Panel(panel: { id: InspectorTab; children: JSX.Element }) {
    return (
      <div
        id={panelId(panel.id)}
        role="tabpanel"
        aria-labelledby={tabId(panel.id)}
        hidden={tab() !== panel.id}
        class="flex flex-col gap-3"
      >
        <Show when={visited().has(panel.id)}>{panel.children}</Show>
      </div>
    )
  }

  const shortenedNotice = () => (
    <Show when={notice()}>
      {text => (
        <p
          class="m-0 rounded-md border border-input px-2.5 py-1.5 text-[12px] text-muted-foreground"
          data-testid="shortened-notice"
        >
          {text()}
        </p>
      )}
    </Show>
  )

  return (
    <aside
      class="flex w-[470px] shrink-0 flex-col border-l border-border bg-secondary"
      aria-label={t('inspector.label')}
      data-testid="inspector"
    >
      <Show when={entry()} fallback={<p class="m-0 px-[22px] py-5 text-[13px] text-subtle">{t('inspector.empty')}</p>}>
        {current => (
          <>
            <div class="flex flex-col gap-3 px-[22px] pt-[18px]">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-[9px]">
                  <KindSquare kind={entryKind(current())} size="title" />
                  <h2 class="m-0 truncate text-[16px] font-semibold tracking-[-0.01em]">{title()}</h2>
                </div>
                <button
                  type="button"
                  class="grid size-6 place-items-center rounded text-subtle hover:bg-accent hover:text-foreground"
                  aria-label={t('inspector.close')}
                  onClick={() => state.setSelectedKey(undefined)}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
              <Show when={meta().length > 0}>
                <div class="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
                  <For each={meta()}>{item => <span>{item}</span>}</For>
                </div>
              </Show>
              <Show when={costLine()}>
                {line => (
                  <p
                    class="m-0 flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-subtle"
                    title={costBasisText(state.cost.version)}
                    data-testid="request-cost"
                  >
                    <For each={line()}>{item => <span class="whitespace-nowrap">{item}</span>}</For>
                  </p>
                )}
              </Show>
              <div
                class="flex gap-[18px] border-b border-border text-[13px]"
                role="tablist"
                aria-label={t('inspector.label')}
                onKeyDown={onTabKey}
              >
                <For each={INSPECTOR_TABS}>
                  {item => (
                    <button
                      type="button"
                      role="tab"
                      id={tabId(item.id)}
                      aria-controls={panelId(item.id)}
                      aria-selected={tab() === item.id}
                      tabindex={tab() === item.id ? 0 : -1}
                      class={cx(
                        'pt-2 pb-2.5 whitespace-nowrap',
                        tab() === item.id
                          ? 'font-medium text-foreground shadow-[inset_0_-2px_0_var(--foreground)]'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => choose(item.id)}
                    >
                      {t(item.label)}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
              <Panel id="input">
                {shortenedNotice()}
                <TextView text={input() || t('inspector.noInput')} muted={!input()} />
              </Panel>
              <Panel id="output">
                {shortenedNotice()}
                <TextView text={output() || t('inspector.noOutput')} muted={!output()} />
              </Panel>
              <Panel id="model">
                {/* Keyed on the event: "Show all" and other local state start fresh for each selection. */}
                <Show when={primaryId()} keyed>
                  {id => (
                    <ModelSaw
                      trace={state.session.trace}
                      model={state.model}
                      eventId={id}
                      onSelectEvent={state.reveal}
                      onCompare={() => state.setTab('compare')}
                    />
                  )}
                </Show>
              </Panel>
              <Panel id="compare">
                <Show when={primaryId()} keyed>
                  {id => <ContextCompare state={state} eventId={id} />}
                </Show>
              </Panel>
              <Panel id="raw">
                <Switch>
                  <Match when={raw.state === 'errored'}>
                    <TextView text={t('inspector.rawUnavailable', { reason: messageOf(raw.error) })} />
                  </Match>
                  <Match when={raw.state === 'ready' && raw()}>
                    {events => (
                      <div class="flex flex-col gap-4">
                        <For each={events()}>
                          {event => (
                            <div class="flex flex-col gap-1.5">
                              <span class="font-mono text-[11px] break-all text-subtle">{`${t('inspector.source')} ${sourceOf(event)}`}</span>
                              <TextView
                                text={
                                  event.notInReport
                                    ? t('report.notIncluded')
                                    : event.originalUnavailable
                                      ? t('inspector.rawUnavailable', { reason: event.originalUnavailable })
                                      : pretty(event.original)
                                }
                                muted={event.notInReport}
                              />
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </Match>
                  <Match when={true}>
                    <TextView text={t('inspector.rawLoading')} muted />
                  </Match>
                </Switch>
              </Panel>
            </div>
          </>
        )}
      </Show>
    </aside>
  )
}
