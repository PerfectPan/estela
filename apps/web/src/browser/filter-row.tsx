import { Show } from 'solid-js'
import { locale } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'
import { HostMark } from '@/browser/host-mark.tsx'

export function FilterRow(props: {
  active: boolean
  label: string
  count: number
  mark?: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      data-host={props.mark}
      class={`flex min-h-8 w-full shrink-0 items-center justify-between gap-2 rounded-[7px] px-2.5 text-left text-[13px] ${props.active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
      onClick={() => props.onClick()}
    >
      <span class="flex min-w-0 items-center gap-[9px] py-1">
        <Show when={props.mark}>{id => <HostMark id={id()} />}</Show>
        <span class="min-w-0">
          <span class="block truncate">{props.label}</span>
          <Show when={props.detail}>
            {detail => (
              <span class="font-mono block truncate text-[11px] text-subtle" title={detail()}>
                {detail()}
              </span>
            )}
          </Show>
        </span>
      </span>
      <span class="font-mono shrink-0 text-[11.5px] text-subtle">{formatNumber(props.count, locale())}</span>
    </button>
  )
}
