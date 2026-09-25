import type { HostListEntry, SessionListRow } from '@rivus/agent-trace-rpc'
import type { JSX } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import {
  bucketKey,
  dayBucket,
  formatActive,
  formatDayHeading,
  formatDuration,
  formatNumber,
  formatOptional,
  formatTokens,
  relativeDay,
  type DayBucket,
} from '@/lib/format.ts'
import { FlagIcons } from '@/browser/flag-icons.tsx'
import { HostMark } from '@/browser/host-mark.tsx'

/**
 * Column widths in px from the design (60 / 70 / 76 / 70 / 70). They hold the longer of the
 * two languages: the widest values are English headers and Chinese durations (`12小时48分`).
 */
const COLUMNS = {
  flags: 'w-16',
  turns: 'w-[60px]',
  requests: 'w-[70px]',
  tokens: 'w-[76px]',
  duration: 'w-[70px]',
  active: 'w-[70px]',
} as const

/** DOM id of a row, for `aria-activedescendant`. */
export function optionId(ref: string): string {
  return `session-${ref}`
}

interface Groups {
  keys: string[]
  buckets: Map<string, DayBucket>
  rows: Map<string, SessionListRow[]>
}

function groupRows(rows: readonly SessionListRow[], now: number): Groups {
  const groups: Groups = { keys: [], buckets: new Map(), rows: new Map() }
  for (const row of rows) {
    const bucket = dayBucket(row.lastActiveAt, now)
    const key = bucketKey(bucket)
    let list = groups.rows.get(key)
    if (!list) {
      list = []
      groups.rows.set(key, list)
      groups.buckets.set(key, bucket)
      groups.keys.push(key)
    }
    list.push(row)
  }
  return groups
}

const dash = () => t('common.dash')

export function SessionList(props: {
  hosts: HostListEntry[]
  rows: SessionListRow[]
  now: number
  selected?: string
  empty: string
  onSelect: (ref: string) => void
  onOpen: (ref: string) => void
  onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent>
  ref?: (element: HTMLDivElement) => void
}) {
  const names = createMemo(() => new Map(props.hosts.map(host => [host.id, host.displayName])))
  // Groups are keyed by day (strings), and rows keep their objects, so a push that changes a
  // few rows re-renders only those rows.
  const groups = createMemo(() => groupRows(props.rows, props.now))
  const heading = (bucket: DayBucket) => {
    if (bucket.kind === 'day')
      return formatDayHeading(bucket.day, locale(), props.now)
    if (bucket.kind === 'today')
      return relativeDay(0, locale())
    if (bucket.kind === 'yesterday')
      return relativeDay(-1, locale())
    return t('browser.earlierThisWeek')
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex h-[34px] shrink-0 items-center gap-3.5 border-b border-border px-[18px] text-[11.5px] text-subtle" aria-hidden="true">
        <span class="w-[22px] shrink-0" />
        <span class="min-w-0 flex-1">{t('browser.session')}</span>
        <span class={`${COLUMNS.flags} shrink-0`} />
        <span class={`${COLUMNS.turns} shrink-0 text-right`}>{t('browser.turns')}</span>
        <span class={`${COLUMNS.requests} shrink-0 text-right`}>{t('browser.requests')}</span>
        <span class={`${COLUMNS.tokens} shrink-0 text-right`}>{t('browser.tokens')}</span>
        <span class={`${COLUMNS.duration} shrink-0 text-right`}>{t('browser.duration')}</span>
        <span class={`${COLUMNS.active} shrink-0 text-right`}>{t('browser.active')}</span>
      </div>
      <div
        ref={props.ref}
        class="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
        role="listbox"
        tabIndex={0}
        aria-label={t('browser.title')}
        aria-activedescendant={props.selected ? optionId(props.selected) : undefined}
        onKeyDown={props.onKeyDown}
      >
        <Show when={props.rows.length > 0} fallback={<p class="px-[18px] py-8 text-[13px] text-muted-foreground">{props.empty}</p>}>
          <For each={groups().keys}>
            {key => (
              <div role="group" aria-label={heading(groups().buckets.get(key)!)}>
                <div class="flex h-[34px] items-center gap-2.5 px-[18px]" aria-hidden="true">
                  <span class="section-label text-muted-foreground">{heading(groups().buckets.get(key)!)}</span>
                  <span class="font-mono text-[11.5px] text-subtle">{formatNumber(groups().rows.get(key)?.length ?? 0, locale())}</span>
                </div>
                <For each={groups().rows.get(key) ?? []}>
                  {row => (
                    <Row
                      row={row}
                      hostName={names().get(row.host) ?? row.host}
                      now={props.now}
                      selected={props.selected === row.ref}
                      onSelect={props.onSelect}
                      onOpen={props.onOpen}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function Row(props: {
  row: SessionListRow
  hostName: string
  now: number
  selected: boolean
  onSelect: (ref: string) => void
  onOpen: (ref: string) => void
}) {
  const count = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const title = () => props.row.title || (props.row.error ? t('common.couldNotRead') : dash())
  // A "could not read" row says why in the row itself, not only on hover (S4).
  const subtitle = () => {
    const error = props.row.error
    if (!error)
      return props.row.cwd
    return props.row.title ? `${t('common.couldNotRead')}: ${error.reason}` : error.reason
  }
  return (
    <div
      id={optionId(props.row.ref)}
      role="option"
      aria-selected={props.selected}
      data-ref={props.row.ref}
      data-host={props.row.host}
      title={props.row.error ? errorTitle(props.row) : undefined}
      class={`session-row flex h-[52px] cursor-default items-center gap-3.5 border-b border-border px-[18px] ${props.selected ? 'bg-selection shadow-[inset_0_0_0_1px_var(--selection-ring)]' : 'hover:bg-accent'}`}
      onClick={() => props.onSelect(props.row.ref)}
      onDblClick={() => props.onOpen(props.row.ref)}
    >
      <HostMark id={props.row.host} />
      <div class="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span class={`truncate text-[14px] ${props.row.error && !props.row.title ? 'text-muted-foreground' : 'text-foreground'}`}>{title()}</span>
        <span class="truncate text-[12px] text-subtle">
          {props.hostName}
          <Show when={subtitle()}>
            {text => (
              <>
                {' · '}
                <span class={props.row.error ? '' : 'font-mono'}>{text()}</span>
              </>
            )}
          </Show>
        </span>
      </div>
      <FlagIcons compactions={props.row.compactions} subagents={props.row.subagents} failedTools={props.row.failedTools} />
      <Cell class={COLUMNS.turns} text={count(props.row.turns)} />
      <Cell class={COLUMNS.requests} text={count(props.row.requests)} />
      <Cell class={COLUMNS.tokens} text={formatOptional(props.row.tokensIn, formatTokens, dash())} />
      <Cell class={COLUMNS.duration} text={formatOptional(props.row.durationMs, v => formatDuration(v, locale()), dash())} />
      <span class={`${COLUMNS.active} shrink-0 text-right text-[12.5px] text-subtle`}>
        {props.row.lastActiveAt ? formatActive(props.row.lastActiveAt, locale(), props.now) : dash()}
      </span>
    </div>
  )
}

function Cell(props: { class: string, text: string }) {
  return <span class={`font-mono ${props.class} shrink-0 text-right text-[12px] text-muted-foreground`}>{props.text}</span>
}

/** Hover text for a "could not read" row: file, line, reason. */
function errorTitle(row: SessionListRow): string {
  const error = row.error
  if (!error)
    return ''
  const where = error.file ? `${error.file}${error.line !== undefined ? `:${error.line}` : ''}` : ''
  return [where, error.reason].filter(Boolean).join('\n')
}
