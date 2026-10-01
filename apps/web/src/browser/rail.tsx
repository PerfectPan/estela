import type { HostListEntry, SessionListRow } from '@rivus/agent-trace-rpc'
import { For, Show } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'
import { RailGroup } from '@/browser/rail-group.tsx'
import { FilterRow } from '@/browser/filter-row.tsx'
import { RailFlag } from '@/browser/rail-flag.tsx'

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
      if (row.project && (!props.host || row.host === props.host)) {
        counts.set(row.project, (counts.get(row.project) ?? 0) + 1)
      }
    }
    const sorted = [...counts.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const shown = sorted.slice(0, PROJECT_LIMIT)
    const active = props.project
    if (active && !shown.some(([name]) => name === active)) {
      shown.push([active, counts.get(active) ?? 0])
    }
    return shown
  }

  return (
    <aside
      class="flex w-[216px] shrink-0 flex-col gap-[22px] overflow-y-auto border-r border-border px-3 py-[18px]"
      aria-label={t('browser.hosts')}
    >
      <RailGroup label={t('browser.hosts')}>
        <FilterRow
          active={!props.host}
          label={t('browser.allHosts')}
          count={total()}
          onClick={() => props.onHost(undefined)}
        />
        <For each={props.hosts}>
          {host => (
            <FilterRow
              active={props.host === host.id}
              label={host.displayName}
              count={host.count}
              mark={host.id}
              detail={host.count === 0 && host.checked ? t('browser.checked', { path: host.checked }) : undefined}
              onClick={() => props.onHost(props.host === host.id ? undefined : host.id)}
            />
          )}
        </For>
      </RailGroup>
      <Show when={projects().length > 0}>
        <RailGroup label={t('browser.projects')}>
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
        </RailGroup>
      </Show>
      <RailGroup label={t('browser.showOnly')}>
        <RailFlag
          name="has-compaction"
          label={t('browser.hasCompaction')}
          checked={props.flags.compaction}
          onChange={value => props.onFlag('compaction', value)}
        />
        <RailFlag
          name="has-subagents"
          label={t('browser.hasSubagents')}
          checked={props.flags.subagents}
          onChange={value => props.onFlag('subagents', value)}
        />
        <RailFlag
          name="has-failed-tools"
          label={t('browser.hasFailedTools')}
          checked={props.flags.failed}
          onChange={value => props.onFlag('failed', value)}
        />
      </RailGroup>
    </aside>
  )
}
