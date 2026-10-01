import { Show } from 'solid-js'
import { WarningIcon } from '@/components/icons.tsx'
import { cx } from '@/lib/cva'

const VALUE = 'm-0 flex items-center gap-1.5 font-mono text-[15px] font-medium whitespace-nowrap'
const LABEL = 'text-[11.5px] whitespace-nowrap text-subtle'

/**
 * A headline number over its label (session header, browser preview). `failed` is the error
 * color with the warning icon. `term` renders a `<dt>` / `<dd>` pair for use inside a `<dl>`:
 * the label comes first for assistive technology and is drawn under the value.
 */
export function Metric(props: { value: string, label: string, failed?: boolean, term?: boolean }) {
  const value = () => (
    <>
      <Show when={props.failed}><WarningIcon /></Show>
      {props.value}
    </>
  )
  const tone = () => props.failed ? 'text-destructive' : 'text-foreground'
  return (
    <Show
      when={props.term}
      fallback={(
        <div class="flex flex-col gap-[3px]">
          <span class={cx(VALUE, tone())}>{value()}</span>
          <span class={LABEL}>{props.label}</span>
        </div>
      )}
    >
      <div class="flex flex-col-reverse gap-[3px]">
        <dt class={LABEL}>{props.label}</dt>
        <dd class={cx(VALUE, tone())}>{value()}</dd>
      </div>
    </Show>
  )
}
