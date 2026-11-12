import type { AgentListEntry, SessionListRow } from '@rivus/estela-rpc'
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

/** Left rail (216 px): agent filter with per-agent counts, project filter, and the three flags. */
export function Rail(props: {
  agents: AgentListEntry[]
  rows: SessionListRow[]
  agent?: string
  project?: string
  flags: Flags
  onAgent: (id?: string) => void
  onProject: (name?: string) => void
  onFlag: (flag: keyof Flags, value: boolean) => void
}) {
  const total = () => props.agents.reduce((sum, agent) => sum + agent.count, 0)
  const projects = () => {
    const counts = new Map<string, number>()
    for (const row of props.rows) {
      if (row.project && (!props.agent || row.agent === props.agent)) {
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
      aria-label={t('browser.agents')}
    >
      <RailGroup label={t('browser.agents')}>
        <FilterRow
          active={!props.agent}
          label={t('browser.allAgents')}
          count={total()}
          onClick={() => props.onAgent(undefined)}
        />
        <For each={props.agents}>
          {agent => (
            <FilterRow
              active={props.agent === agent.id}
              label={agent.displayName}
              count={agent.count}
              mark={agent.id}
              detail={agent.count === 0 && agent.checked ? t('browser.checked', { path: agent.checked }) : undefined}
              onClick={() => props.onAgent(props.agent === agent.id ? undefined : agent.id)}
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
