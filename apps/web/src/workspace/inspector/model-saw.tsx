import type { ContextSlot, ContextSlotName, ReconstructResult, Trace } from '@rivus/agent-trace-schema'
import type { LedgerModel } from '@/lib/ledger-model.ts'
import type { MessageKey } from '@/i18n/locale.ts'
import { reconstruct } from '@rivus/agent-trace-kernel'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { ArrowRightIcon } from '@/components/icons.tsx'
import { locale, plural, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { rowLine, rowText } from '@/lib/event-text.ts'
import { formatNumber, formatTokens } from '@/lib/format.ts'
import { unavailableNote } from '@/lib/unavailable-note.ts'

const SLOT_LABEL: Record<ContextSlotName, MessageKey> = {
  system: 'inspector.slots.system',
  tools: 'inspector.slots.tools',
  summary: 'inspector.slots.summary',
  messages: 'inspector.slots.messages',
  currentTurn: 'inspector.slots.currentTurn',
}

/** Slot colors from the design: tools orange, summary purple, messages blue, this turn green. */
const SLOT_FILL: Record<ContextSlotName, string> = {
  system: 'bg-subtle',
  tools: 'bg-kind-tool',
  summary: 'bg-kind-thinking',
  messages: 'bg-kind-request',
  currentTurn: 'bg-kind-user',
}

/** Removed events listed before "Show all". */
const PREVIEW_DROPPED = 3
/** Rows drawn after "Show all"; the rest is a count. */
const MAX_DROPPED = 300

function covers(names: ContextSlotName[]): string {
  return names.length === 5 ? t('inspector.allSlots') : names.map(name => t(SLOT_LABEL[name])).join(t('inspector.listSeparator'))
}

function Pill(props: { children: string }) {
  return <span class="rounded-full border border-input px-[9px] py-px text-[12px] whitespace-nowrap text-muted-foreground">{props.children}</span>
}

/** Hatched when the host does not record the slot, outlined when it is empty, else the slot color. */
function slotClass(slot: ContextSlot, small = false): string {
  if (slot.status === 'unavailable')
    return small ? 'hatched hatched-small' : 'hatched'
  return slot.status === 'empty' ? 'border border-input' : SLOT_FILL[slot.name]
}

/**
 * "Model saw" (S7): the composition at the selected event from `reconstruct`, the token
 * counts the host recorded (each with the slots it covers; never split or estimated), and
 * the events a compaction removed before it. An unrecorded slot is hatched and "unavailable".
 */
export function ModelSaw(props: { trace: Trace, model: LedgerModel, eventId: string, onSelectEvent: (id: string) => void }) {
  const result = createMemo((): ReconstructResult => reconstruct(props.trace, props.eventId))
  const event = () => props.model.byId.get(props.eventId)
  const isRequest = () => event()?.kind === 'request'
  const slots = () => result().slots ?? []
  const unavailable = () => slots().filter(slot => slot.status === 'unavailable')
  const inputGroup = () => result().tokens?.find(group => group.from === 'request.inputTokens')
  const headline = () => inputGroup() ?? result().tokens?.[0]
  /** Input tokens of the previous request on the same lane. */
  const earlier = () => {
    const found = props.model.requests.get(props.eventId)
    return found && found.index > 0 ? found.lane.requests[found.index - 1]!.inputTokens : undefined
  }
  const completeness = () => {
    const missing = unavailable().length
    if (result().completeness === 'unavailable')
      return t('inspector.notReconstructable')
    if (missing === 0)
      return t('inspector.complete')
    return missing === 1 ? t('inspector.partialOne') : t('inspector.partialMany', { count: missing })
  }
  const note = () => unavailableNote(props.trace.capabilities, slots())
  const [showAll, setShowAll] = createSignal(false)
  const removed = () => result().removedIds ?? []
  const shownRemoved = () => showAll() ? removed().slice(0, MAX_DROPPED) : removed().slice(0, PREVIEW_DROPPED)
  const summaryText = createMemo(() => {
    const summary = slots().find(slot => slot.name === 'summary')
    const texts = (summary?.eventIds ?? []).map(id => props.model.byId.get(id)).map(found => found ? rowText(found).text ?? '' : '').filter(Boolean)
    return texts.join(' ')
  })

  return (
    <div class="flex flex-col gap-[18px]" data-testid="model-saw">
      <div class="flex flex-col gap-3">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="section-label m-0 text-muted-foreground">{isRequest() ? t('inspector.contextAtRequest') : t('inspector.contextAtEvent')}</h3>
          <Pill>{completeness()}</Pill>
        </div>
        <Show
          when={headline()}
          fallback={<p class="m-0 text-[13px] text-subtle">{t('inspector.noTokens')}</p>}
        >
          {group => (
            <div class="font-mono text-[26px] font-medium tracking-[-0.02em]">
              {formatTokens(group().tokens)}
              {' '}
              <span class="text-[13px] font-normal tracking-normal text-subtle">
                {t('inspector.tokens')}
                <Show when={earlier()}>{value => ` · ${t('inspector.wasEarlier', { value: formatTokens(value()) })}`}</Show>
              </span>
            </div>
          )}
        </Show>
        <div class="flex gap-0.5" aria-hidden="true">
          <For each={slots()}>
            {slot => (
              <div
                class={cx('box-border h-3 flex-1 rounded-[3px]', slotClass(slot))}
              />
            )}
          </For>
        </div>
        <ul class="m-0 flex list-none flex-col p-0">
          <For each={slots()}>
            {slot => (
              <li class="flex h-[27px] items-center justify-between border-b border-border" data-slot={slot.name} data-status={slot.status}>
                <span class="flex items-center gap-[9px] text-[13px] text-foreground">
                  <span class={cx('box-border size-[9px] shrink-0 rounded-[2px]', slotClass(slot, true))} aria-hidden="true" />
                  {t(SLOT_LABEL[slot.name])}
                </span>
                <span class="flex items-baseline gap-2.5">
                  <Show when={slot.recordedBy}>
                    {id => (
                      <button
                        type="button"
                        class="text-[12px] text-link hover:underline"
                        data-testid="slot-source"
                        onClick={() => props.onSelectEvent(id())}
                      >
                        {props.model.ordinals.get(id()) ? t('inspector.slotRecordedAt', { ordinal: props.model.ordinals.get(id())! }) : t('inspector.slotRecorded')}
                      </button>
                    )}
                  </Show>
                  <span class={cx('font-mono text-[12px]', slot.status === 'present' ? 'text-muted-foreground' : 'text-subtle')}>
                  {slot.status === 'unavailable'
                    ? t('inspector.slotUnavailable')
                    : slot.status === 'empty'
                      ? t('inspector.slotEmpty')
                      : slot.eventIds.length > 0 ? plural(slot.eventIds.length, 'inspector.slotEventsOne', 'inspector.slotEvents', formatNumber(slot.eventIds.length, locale())) : ''}
                  </span>
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={(result().tokens?.length ?? 0) > 0}>
          <div class="flex flex-col gap-1.5" data-testid="recorded-counts">
            <span class="text-[12px] text-subtle">{t('inspector.recordedCounts')}</span>
            <For each={result().tokens}>
              {group => (
                <div class="flex items-baseline gap-2.5 text-[12.5px]" data-from={group.from} data-tokens={group.tokens} data-slots={group.slots.join(' ')}>
                  <span class="w-[52px] shrink-0 font-mono text-foreground">{formatTokens(group.tokens)}</span>
                  <span class="text-muted-foreground">
                    {group.from === 'request.inputTokens' ? t('inspector.fromInput') : t('inspector.fromPost')}
                    {' · '}
                    {covers(group.slots)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={note()}>
          {text => <p class="m-0 text-[12px] leading-normal text-subtle">{text()}</p>}
        </Show>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <h3 class="section-label m-0 text-muted-foreground">{t('inspector.dropped')}</h3>
          <span class="font-mono text-[12px] text-muted-foreground">{plural(removed().length, 'inspector.droppedCountOne', 'inspector.droppedCount', formatNumber(removed().length, locale()))}</span>
        </div>
        <Show when={removed().length > 0} fallback={<p class="m-0 text-[12.5px] text-subtle">{t('inspector.noneDropped')}</p>}>
          <ul class="m-0 flex list-none flex-col p-0" data-testid="dropped">
            <For each={shownRemoved()}>
              {(id) => {
                const found = () => props.model.byId.get(id)
                const text = () => {
                  const current = found()
                  return current ? rowLine(current) : id
                }
                return (
                  <li>
                    <button type="button" class="flex h-[26px] w-full min-w-0 items-center gap-2.5 text-left" onClick={() => props.onSelectEvent(id)}>
                      <span class="w-[34px] shrink-0 font-mono text-[11px] text-subtle">{props.model.ordinals.get(id) ? `#${props.model.ordinals.get(id)}` : ''}</span>
                      <span class="min-w-0 truncate text-[12.5px] text-subtle line-through decoration-hatch-edge [unicode-bidi:isolate]" dir="auto">{text()}</span>
                    </button>
                  </li>
                )
              }}
            </For>
          </ul>
          <Show when={showAll() && removed().length > MAX_DROPPED}>
            <span class="text-[12px] text-subtle">{t('inspector.andMore', { count: formatNumber(removed().length - MAX_DROPPED, locale()) })}</span>
          </Show>
          <Show when={showAll() && summaryText()}>
            {text => <p class="m-0 rounded-md border border-border bg-background p-2.5 text-[12.5px] leading-normal text-muted-foreground [unicode-bidi:isolate]" dir="auto">{text()}</p>}
          </Show>
          <Show when={removed().length > PREVIEW_DROPPED || summaryText()}>
            <button type="button" class="flex items-center gap-1.5 self-start text-[12.5px] text-link hover:underline" onClick={() => setShowAll(!showAll())}>
              {showAll() ? t('inspector.showFewer') : t('inspector.showAll', { count: formatNumber(removed().length, locale()) })}
              <Show when={!showAll()}><ArrowRightIcon size={13} /></Show>
            </button>
          </Show>
        </Show>
      </div>
    </div>
  )
}
