import type { HostListEntry, SessionListRow } from '@rivus/agent-trace-rpc'
import { For, Show } from 'solid-js'
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

interface Group {
  key: string
  bucket: DayBucket
  rows: SessionListRow[]
}

export function groupRows(rows: readonly SessionListRow[], now: number): Group[] {
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  for (const row of rows) {
    const bucket = dayBucket(row.lastActiveAt, now)
    const key = bucketKey(bucket)
    let group = byKey.get(key)
    if (!group) {
      group = { key, bucket, rows: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

export function SessionList(props: {
  hosts: HostListEntry[]
  rows: SessionListRow[]
  now: number
  selected?: string
  empty: string
  onSelect: (ref: string) => void
  onOpen: (ref: string) => void
  ref?: (element: HTMLDivElement) => void
}) {
  const nameOf = (id: string) => props.hosts.find(host => host.id === id)?.displayName ?? id
  const groups = () => groupRows(props.rows, props.now)
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
      <div class="flex h-[34px] shrink-0 items-center gap-3.5 border-b border-border px-[18px] text-[11.5px] text-subtle" role="row">
        <span class="w-[22px] shrink-0" />
        <span class="min-w-0 flex-1">{t('browser.session')}</span>
        <span class={`${COLUMNS.flags} shrink-0`} />
        <span class={`${COLUMNS.turns} shrink-0 text-right`}>{t('browser.turns')}</span>
        <span class={`${COLUMNS.requests} shrink-0 text-right`}>{t('browser.requests')}</span>
        <span class={`${COLUMNS.tokens} shrink-0 text-right`}>{t('browser.tokens')}</span>
        <span class={`${COLUMNS.duration} shrink-0 text-right`}>{t('browser.duration')}</span>
        <span class={`${COLUMNS.active} shrink-0 text-right`}>{t('browser.active')}</span>
      </div>
      <div ref={props.ref} class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label={t('browser.title')}>
        <Show when={props.rows.length > 0} fallback={<p class="px-[18px] py-8 text-[13px] text-muted-foreground">{props.empty}</p>}>
          <For each={groups()}>
            {group => (
              <>
                <div class="flex h-[34px] items-center gap-2.5 px-[18px]">
                  <span class="section-label text-muted-foreground">{heading(group.bucket)}</span>
                  <span class="data text-[11.5px] text-subtle">{formatNumber(group.rows.length, locale())}</span>
                </div>
                <For each={group.rows}>
                  {row => (
                    <Row
                      row={row}
                      hostName={nameOf(row.host)}
                      now={props.now}
                      selected={props.selected === row.ref}
                      onSelect={props.onSelect}
                      onOpen={props.onOpen}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

const dash = () => t('common.dash')

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
  // A "could not read" row names the file when it has no title, so two such rows can be told apart.
  const subtitle = () => {
    const error = props.row.error
    if (!error)
      return props.row.cwd
    return props.row.title ? t('common.couldNotRead') : (error.file ?? t('common.couldNotRead'))
  }
  return (
    <div
      role="option"
      aria-selected={props.selected}
      data-ref={props.row.ref}
      tabIndex={-1}
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
                <span class={props.row.error && props.row.title ? '' : 'data'}>{text()}</span>
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
  return <span class={`data ${props.class} shrink-0 text-right text-[12px] text-muted-foreground`}>{props.text}</span>
}

/** Hover text for a "could not read" row: file, line, reason (S4). */
export function errorTitle(row: SessionListRow): string {
  const error = row.error
  if (!error)
    return ''
  const where = error.file ? `${error.file}${error.line !== undefined ? `:${error.line}` : ''}` : ''
  return [where, error.reason].filter(Boolean).join('\n')
}
