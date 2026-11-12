import type { SlotDiff, SystemDiff, ToolsDiff } from '@rivus/estela-kernel'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { formatNumber } from '@/lib/format.ts'
import { SLOT_LABEL, slotClass } from './slot-style.ts'

function signed(sign: '+' | '−', count: number): string {
  return `${sign}${formatNumber(count, locale())}`
}

/** The right-hand text of a slot row: content change for the system prompt and tools, event counts otherwise. */
function changeText(diff: SlotDiff, system: SystemDiff, tools: ToolsDiff): string {
  if (diff.change === 'unavailable') {
    return t('inspector.slotUnavailable')
  }
  if (diff.name === 'system') {
    return system.change === 'changed' ? t('compare.changed') : t('compare.same')
  }
  if (diff.name === 'tools') {
    if (tools.change !== 'changed') {
      return t('compare.same')
    }
    if (!tools.added || !tools.removed) {
      return t('compare.toolsChangedNoNames')
    }
    return (
      [...tools.added.map(name => `+${name}`), ...tools.removed.map(name => `−${name}`)].join(' ')
      || t('compare.changed')
    )
  }
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return t('compare.noChange')
  }
  const parts = [
    diff.added.length > 0 ? signed('+', diff.added.length) : '',
    diff.removed.length > 0 ? signed('−', diff.removed.length) : '',
    diff.unchanged.length > 0 ? t('compare.kept', { count: formatNumber(diff.unchanged.length, locale()) }) : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

/** One slot of the diff: its mark (hatched when either side does not record it), name, and change. */
export function CompareSlotRow(props: { diff: SlotDiff; system: SystemDiff; tools: ToolsDiff }) {
  const status = () => (props.diff.change === 'unavailable' ? 'unavailable' : props.diff.after)
  const changed = () => {
    const diff = props.diff
    if (diff.change === 'unavailable') {
      return false
    }
    if (diff.name === 'system') {
      return props.system.change === 'changed'
    }
    if (diff.name === 'tools') {
      return props.tools.change === 'changed'
    }
    return diff.added.length > 0 || diff.removed.length > 0
  }
  return (
    <li
      class="flex min-h-[27px] items-center justify-between gap-3 border-b border-border py-1"
      data-slot={props.diff.name}
      data-change={props.diff.change === 'unavailable' ? 'unavailable' : changed() ? 'changed' : 'same'}
    >
      <span class="flex shrink-0 items-center gap-[9px] text-[13px] text-foreground">
        <span
          class={cx(
            'box-border size-[9px] shrink-0 rounded-[2px]',
            slotClass({ name: props.diff.name, status: status() }, true),
          )}
          aria-hidden="true"
        />
        {t(SLOT_LABEL[props.diff.name])}
      </span>
      <span
        class={cx(
          'min-w-0 text-right font-mono text-[12px] break-words',
          changed() ? 'text-foreground' : 'text-subtle',
        )}
      >
        {changeText(props.diff, props.system, props.tools)}
        <Show when={props.diff.change === 'compared' && props.diff.before !== props.diff.after}>
          <span class="ml-2 text-subtle">
            {t('compare.statusChange', {
              before: t(props.diff.before === 'empty' ? 'inspector.slotEmpty' : 'compare.present'),
              after: t(props.diff.after === 'empty' ? 'inspector.slotEmpty' : 'compare.present'),
            })}
          </span>
        </Show>
      </span>
    </li>
  )
}
