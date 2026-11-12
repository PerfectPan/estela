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
export function Metric(props: {
  value: string
  label: string
  failed?: boolean
  term?: boolean
  /** The value is a word such as "unavailable", not a number: drawn in the secondary text color. */
  muted?: boolean
  /** A tooltip on the whole metric. */
  title?: string
  testId?: string
}) {
  const value = () => (
    <>
      <Show when={props.failed}>
        <WarningIcon />
      </Show>
      {props.value}
    </>
  )
  const tone = () => (props.failed ? 'text-destructive' : props.muted ? 'text-muted-foreground' : 'text-foreground')
  return (
    <Show
      when={props.term}
      fallback={
        <div class="flex flex-col gap-[3px]" title={props.title} data-testid={props.testId}>
          <span class={cx(VALUE, tone())}>{value()}</span>
          <span class={LABEL}>{props.label}</span>
        </div>
      }
    >
      <div class="flex flex-col-reverse gap-[3px]" title={props.title} data-testid={props.testId}>
        <dt class={LABEL}>{props.label}</dt>
        <dd class={cx(VALUE, tone())}>{value()}</dd>
      </div>
    </Show>
  )
}
