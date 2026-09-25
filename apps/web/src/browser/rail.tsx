import type { JSX } from 'solid-js'
import type { HostListEntry, SessionListRow } from '@rivus/agent-trace-rpc'
import { For, Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'
import { HostMark } from '@/browser/host-mark.tsx'

export interface Flags {
  compaction: boolean
  subagents: boolean
  failed: boolean
}

/** Projects shown in the rail, by row count. The active one is always shown. */
const PROJECT_LIMIT = 8

/** Left rail (216 px): host filter with per-host counts, project filter, and the three flags. */
export function Rail(props: {
  hosts: HostListEntry[]
  rows: SessionListRow[]
  host?: string
  project?: string
  flags: Flags
  onHost: (id?: string) => void
  onProject: (name?: string) => void
  onFlag: (flag: keyof Flags, value: boolean) => void
}) {
  const total = () => props.hosts.reduce((sum, host) => sum + host.count, 0)
  const projects = () => {
    const counts = new Map<string, number>()
    for (const row of props.rows) {
      if (row.project && (!props.host || row.host === props.host))
        counts.set(row.project, (counts.get(row.project) ?? 0) + 1)
    }
    const sorted = [...counts.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const shown = sorted.slice(0, PROJECT_LIMIT)
    const active = props.project
    if (active && !shown.some(([name]) => name === active))
      shown.push([active, counts.get(active) ?? 0])
    return shown
  }

  return (
    <aside class="flex w-[216px] shrink-0 flex-col gap-[22px] overflow-y-auto border-r border-border px-3 py-[18px]" aria-label={t('browser.hosts')}>
      <Group label={t('browser.hosts')}>
        <FilterRow active={!props.host} label={t('browser.allHosts')} count={total()} onClick={() => props.onHost(undefined)} />
        <For each={props.hosts}>
          {host => (
            <FilterRow
              active={props.host === host.id}
              label={host.displayName}
              count={host.count}
              mark={host.id}
              host={host.id}
              detail={host.count === 0 && host.checked ? t('browser.checked', { path: host.checked }) : undefined}
              onClick={() => props.onHost(props.host === host.id ? undefined : host.id)}
            />
          )}
        </For>
      </Group>
      <Show when={projects().length > 0}>
        <Group label={t('browser.projects')}>
          <For each={projects()}>
            {([name, count]) => (
              <FilterRow
                active={props.project === name}
                label={name}
                count={count}
                onClick={() => props.onProject(props.project === name ? undefined : name)}
              />
            )}
          </For>
        </Group>
      </Show>
      <Group label={t('browser.showOnly')}>
        <Flag name="has-compaction" label={t('browser.hasCompaction')} checked={props.flags.compaction} onChange={value => props.onFlag('compaction', value)} />
        <Flag name="has-subagents" label={t('browser.hasSubagents')} checked={props.flags.subagents} onChange={value => props.onFlag('subagents', value)} />
        <Flag name="has-failed-tools" label={t('browser.hasFailedTools')} checked={props.flags.failed} onChange={value => props.onFlag('failed', value)} />
      </Group>
    </aside>
  )
}

function Group(props: { label: string, children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="rail-label px-2.5 pb-1.5 text-subtle">{props.label}</span>
      {props.children}
    </div>
  )
}

function FilterRow(props: {
  active: boolean
  label: string
  count: number
  mark?: string
  /** Host rows carry `data-host` for the end-to-end suite. */
  host?: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      data-host={props.host}
      class={`flex min-h-8 w-full shrink-0 items-center justify-between gap-2 rounded-[7px] px-2.5 text-left text-[13px] ${props.active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
      onClick={() => props.onClick()}
    >
      <span class="flex min-w-0 items-center gap-[9px] py-1">
        <Show when={props.mark}>
          {id => <HostMark id={id()} />}
        </Show>
        <span class="min-w-0">
          <span class="block truncate">{props.label}</span>
          <Show when={props.detail}>
            {detail => <span class="font-mono block truncate text-[11px] text-subtle" title={detail()}>{detail()}</span>}
          </Show>
        </span>
      </span>
      <span class="font-mono shrink-0 text-[11.5px] text-subtle">{formatNumber(props.count, locale())}</span>
    </button>
  )
}

function Flag(props: { name: string, label: string, checked: boolean, onChange: (value: boolean) => void }) {
  return (
    <label class="flex h-7 cursor-pointer items-center gap-[9px] px-2.5 text-[13px] text-muted-foreground hover:text-foreground">
      <input
        type="checkbox"
        name={props.name}
        id={props.name}
        class="peer sr-only"
        checked={props.checked}
        onChange={event => props.onChange(event.currentTarget.checked)}
      />
      <span
        class={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${props.checked ? 'border-kind-request bg-kind-request' : 'border-input'}`}
        aria-hidden="true"
      >
        <Show when={props.checked}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--background)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.5 L10 17 L19 7" />
          </svg>
        </Show>
      </span>
      {props.label}
    </label>
  )
}
