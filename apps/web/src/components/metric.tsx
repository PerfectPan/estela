import { Show } from 'solid-js'
import { WarningIcon } from '@/components/icons.tsx'
import { cx } from '@/lib/cva'

/** A headline number over its label (session header, browser preview). `failed` is the error color with the warning icon. */
export function Metric(props: { value: string, label: string, failed?: boolean }) {
  return (
    <div class="flex flex-col gap-[3px]">
      <span class={cx('flex items-center gap-1.5 font-mono text-[15px] font-medium whitespace-nowrap', props.failed ? 'text-destructive' : 'text-foreground')}>
        <Show when={props.failed}><WarningIcon /></Show>
        {props.value}
      </span>
      <span class="text-[11.5px] whitespace-nowrap text-subtle">{props.label}</span>
    </div>
  )
}
