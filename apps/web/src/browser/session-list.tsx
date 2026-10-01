import type { HostListEntry, SessionListRow } from '@rivus/agent-trace-rpc'
import type { JSX } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { bucketKey, dayBucket, formatDayHeading, formatNumber, relativeDay, type DayBucket } from '@/lib/format.ts'
import { COLUMNS, optionId } from '@/browser/session-list-layout.ts'
import { SessionRow } from '@/browser/session-row.tsx'

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
    if (bucket.kind === 'day') {
      return formatDayHeading(bucket.day, locale(), props.now)
    }
    if (bucket.kind === 'today') {
      return relativeDay(0, locale())
    }
    if (bucket.kind === 'yesterday') {
      return relativeDay(-1, locale())
    }
    return t('browser.earlierThisWeek')
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div
        class="flex h-[34px] shrink-0 items-center gap-3.5 border-b border-border px-[18px] text-[11.5px] text-subtle"
        aria-hidden="true"
      >
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
        <Show
          when={props.rows.length > 0}
          fallback={<p class="px-[18px] py-8 text-[13px] text-muted-foreground">{props.empty}</p>}
        >
          <For each={groups().keys}>
            {key => (
              <div role="group" aria-label={heading(groups().buckets.get(key)!)}>
                <div class="flex h-[34px] items-center gap-2.5 px-[18px]" aria-hidden="true">
                  <span class="section-label text-muted-foreground">{heading(groups().buckets.get(key)!)}</span>
                  <span class="font-mono text-[11.5px] text-subtle">
                    {formatNumber(groups().rows.get(key)?.length ?? 0, locale())}
                  </span>
                </div>
                <For each={groups().rows.get(key) ?? []}>
                  {row => (
                    <SessionRow
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
