import type { EventDetail } from '@rivus/agent-trace-rpc'
import type { Entry, RowKind } from '@/lib/ledger-model.ts'
import type { MessageKey } from '@/i18n/locale.ts'
import type { WorkspaceState } from '../workspace-state.ts'
import { For, Match, Show, Switch, createMemo, createResource, createSignal } from 'solid-js'
import { CloseIcon } from '@/components/icons.tsx'
import { KIND_TITLE, KindSquare } from '@/components/kind-mark.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { isShortened, numberField, pretty, requestNumbers, toolName } from '@/lib/event-text.ts'
import { formatDuration, formatElapsed, formatTokens } from '@/lib/format.ts'
import { entryEventId } from '../workspace-state.ts'
import { ModelSaw } from './model-saw.tsx'
import { inputText, outputText } from './tab-text.ts'

type Tab = 'input' | 'output' | 'model' | 'raw'

const TABS: { id: Tab, label: MessageKey }[] = [
  { id: 'input', label: 'inspector.input' },
  { id: 'output', label: 'inspector.output' },
  { id: 'model', label: 'inspector.model' },
  { id: 'raw', label: 'inspector.raw' },
]

/** Full events fetched through `get-event`, kept for the last few selections (a full output can be megabytes). */
const CACHE_SIZE = 24

function entryKind(entry: Entry): RowKind {
  switch (entry.type) {
    case 'event': return entry.kind
    case 'hooks': return 'hook'
    case 'compaction': return 'compaction'
    case 'subagent': return 'subagent'
  }
}

function entryOrdinal(entry: Entry): number | undefined {
  return entry.type === 'hooks' ? undefined : entry.ordinal || undefined
}

/**
 * Inspector (470 px): Input, Output, Model saw, Raw. A shortened event (S12) loads its full
 * text through `get-event` on selection; "Raw" shows the pretty-printed original record.
 */
export function Inspector(props: { state: WorkspaceState, start: number }) {
  const state = props.state
  const [tab, setTab] = createSignal<Tab>('input')
  const cache = new Map<string, Promise<EventDetail>>()
  function fetchEvent(id: string): Promise<EventDetail> {
    let found = cache.get(id)
    if (!found) {
      found = state.session.event(id)
      cache.set(id, found)
      found.catch(() => cache.delete(id))
      if (cache.size > CACHE_SIZE)
        cache.delete(cache.keys().next().value!)
    }
    return found
  }

  const entry = () => state.selectedEntry()
  const primaryId = createMemo(() => entryEventId(entry()))
  const resultId = () => {
    const current = entry()
    return current && (current.type === 'event' || current.type === 'subagent') ? current.resultId : undefined
  }
  const ids = createMemo(() => [primaryId(), resultId()].filter((id): id is string => id !== undefined))
  const shortenedIds = createMemo(() => ids().filter(id => isShortened(state.model.byId.get(id))))
  const [full] = createResource(
    () => shortenedIds().length > 0 ? shortenedIds().join('\0') : undefined,
    async key => new Map((await Promise.all(key.split('\0').map(fetchEvent))).map(event => [event.id, event])),
  )
  const [raw] = createResource(
    () => tab() === 'raw' && ids().length > 0 ? ids().join('\0') : undefined,
    key => Promise.all(key.split('\0').map(fetchEvent)),
  )
  const lookup = (id: string) => (full.state === 'ready' ? full()?.get(id) : undefined) ?? state.model.byId.get(id)
  const primary = () => primaryId() ? lookup(primaryId()!) : undefined
  const result = () => resultId() ? lookup(resultId()!) : undefined

  const title = () => {
    const current = entry()
    if (!current)
      return ''
    const ordinal = entryOrdinal(current)
    return `${t(KIND_TITLE[entryKind(current)])}${ordinal ? ` #${ordinal}` : ''}`
  }
  const meta = createMemo((): string[] => {
    const event = state.model.byId.get(primaryId() ?? '')
    if (!event)
      return []
    const at = event.ts > 0 ? formatElapsed(event.ts - props.start) : ''
    if (event.kind === 'request') {
      const numbers = requestNumbers(event)
      return [
        numbers.model ?? '',
        numbers.inputTokens !== undefined ? t('inspector.inTokens', { value: formatTokens(numbers.inputTokens) }) : '',
        numbers.outputTokens !== undefined ? t('inspector.outTokens', { value: formatTokens(numbers.outputTokens) }) : '',
        numbers.durationMs !== undefined ? formatDuration(numbers.durationMs, locale()) : '',
        numbers.stopReason ? t('inspector.stop', { reason: numbers.stopReason }) : '',
      ].filter(Boolean)
    }
    if (event.kind === 'tool_call') {
      const outcome = state.model.byId.get(resultId() ?? '')
      const code = numberField(outcome, 'exitCode')
      return [toolName(event), code !== undefined ? t('ledger.exit', { code }) : '', at].filter(Boolean)
    }
    return [at].filter(Boolean)
  })
  const notice = () => {
    if (shortenedIds().length === 0)
      return undefined
    if (full.state === 'errored')
      return t('inspector.shortenedFailed', { reason: String((full.error as Error | undefined)?.message ?? full.error) })
    return full.state === 'ready' ? t('inspector.shortenedLoaded') : t('inspector.shortenedLoading')
  }
  const sourceOf = (event: EventDetail) => {
    const file = state.session.trace.sourceFiles?.[Number(event.source.file)] ?? event.source.file
    return `${file}:${event.source.line}`
  }

  return (
    <aside class="flex w-[470px] shrink-0 flex-col border-l border-border bg-secondary" aria-label={t('inspector.model')} data-testid="inspector">
      <Show when={entry()} fallback={<p class="m-0 px-[22px] py-5 text-[13px] text-subtle">{t('inspector.empty')}</p>}>
        {current => (
          <>
            <div class="flex flex-col gap-3 px-[22px] pt-[18px]">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-[9px]">
                  <KindSquare kind={entryKind(current())} size="title" />
                  <h2 class="m-0 truncate text-[16px] font-semibold tracking-[-0.01em]">{title()}</h2>
                </div>
                <button type="button" class="grid size-6 place-items-center rounded text-subtle hover:bg-accent hover:text-foreground" aria-label={t('inspector.close')} onClick={() => state.setSelectedKey(undefined)}>
                  <CloseIcon size={16} />
                </button>
              </div>
              <Show when={meta().length > 0}>
                <div class="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
                  <For each={meta()}>{item => <span>{item}</span>}</For>
                </div>
              </Show>
              <div class="flex gap-[22px] border-b border-border text-[13px]" role="tablist">
                <For each={TABS}>
                  {item => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab() === item.id}
                      class={cx(
                        'pt-2 pb-2.5 whitespace-nowrap',
                        tab() === item.id ? 'font-medium text-foreground shadow-[inset_0_-2px_0_var(--foreground)]' : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setTab(item.id)}
                    >
                      {t(item.label)}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto px-[22px] py-4" role="tabpanel">
              <Switch>
                <Match when={tab() === 'model' && primaryId()}>
                  {id => <ModelSaw trace={state.session.trace} model={state.model} eventId={id()} onSelectEvent={state.reveal} />}
                </Match>
                <Match when={tab() === 'raw'}>
                  <Switch>
                    <Match when={raw.state === 'errored'}>
                      <Body text={t('inspector.rawUnavailable', { reason: String((raw.error as Error | undefined)?.message ?? raw.error) })} />
                    </Match>
                    <Match when={raw.state === 'ready' && raw()}>
                      {events => (
                        <div class="flex flex-col gap-4">
                          <For each={events()}>
                            {event => (
                              <div class="flex flex-col gap-1.5">
                                <span class="font-mono text-[11px] break-all text-subtle">{`${t('inspector.source')} ${sourceOf(event)}`}</span>
                                <Body text={event.originalUnavailable ? t('inspector.rawUnavailable', { reason: event.originalUnavailable }) : pretty(event.original)} />
                              </div>
                            )}
                          </For>
                        </div>
                      )}
                    </Match>
                    <Match when={true}>
                      <Body text={t('inspector.rawLoading')} muted />
                    </Match>
                  </Switch>
                </Match>
                <Match when={true}>
                  <div class="flex flex-col gap-3">
                    <Show when={notice()}>
                      {text => <p class="m-0 rounded-md border border-input px-2.5 py-1.5 text-[12px] text-muted-foreground" data-testid="shortened-notice">{text()}</p>}
                    </Show>
                    <Show
                      when={tab() === 'input' ? inputText(current(), primary(), lookup) : outputText(current(), primary(), result(), state.model, lookup)}
                      fallback={<Body text={tab() === 'input' ? t('inspector.noInput') : t('inspector.noOutput')} muted />}
                    >
                      {text => <Body text={text()} />}
                    </Show>
                  </div>
                </Match>
              </Switch>
            </div>
          </>
        )}
      </Show>
    </aside>
  )
}

function Body(props: { text: string, muted?: boolean }) {
  return (
    <pre class={cx('m-0 font-mono text-[11.5px] leading-[1.6] break-words whitespace-pre-wrap', props.muted ? 'text-subtle' : 'text-foreground')} data-testid="inspector-body">
      {props.text}
    </pre>
  )
}
