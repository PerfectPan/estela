import type { JSX } from 'solid-js'
import type { CostTotal, TraceCost } from '@rivus/estela-kernel'
import type { LedgerModel } from '@/lib/ledger-model.ts'
import { Show } from 'solid-js'
import { KindMark } from '@/components/kind-mark.tsx'
import { cx } from '@/lib/cva'
import { elapsedFrom } from '@/lib/format.ts'

export interface RowContext {
  model: LedgerModel
  /** Every request priced, with lane totals. */
  cost: TraceCost
  /** Cost of each turn, by turn group id. */
  turnCosts: ReadonlyMap<string, CostTotal>
  /** Session start, for the elapsed time column. */
  start: number
  dim: boolean
}

export function elapsed(ts: number | undefined, ctx: RowContext): string {
  return elapsedFrom(ts, ctx.start)
}

/** Base row: 36 px, number, kind, content, status, metric (164 px, sized for zh-CN), time. */
export function RowFrame(props: {
  ordinal?: number
  kind: Parameters<typeof KindMark>[0]['kind']
  depth: 0 | 1
  dimmed: boolean
  lane?: boolean
  children: JSX.Element
  /** After the content, outside its ellipsis, so it stays visible (S12). */
  marker?: JSX.Element
  status?: JSX.Element
  metric?: string
  time: string
}) {
  return (
    <div
      class={cx(
        'flex h-full items-center gap-3.5 border-b border-border pr-4',
        props.depth === 1 ? 'pl-11' : 'pl-5',
        props.dimmed && 'opacity-45',
      )}
    >
      <Show when={props.depth === 1}>
        <span
          class={cx('-ml-6 h-full w-0.5 shrink-0', props.lane ? 'bg-kind-subagent/60' : 'bg-input')}
          aria-hidden="true"
        />
      </Show>
      <span class="w-[30px] shrink-0 font-mono text-[11px] text-subtle">{props.ordinal || ''}</span>
      <KindMark kind={props.kind} />
      <div class="min-w-0 flex-1 truncate text-[13px] text-foreground [unicode-bidi:isolate]" dir="auto">
        {props.children}
      </div>
      {props.marker}
      {props.status}
      <span class="w-[164px] shrink-0 truncate text-right font-mono text-[11.5px] text-muted-foreground">
        {props.metric ?? ''}
      </span>
      <span class="w-[52px] shrink-0 text-right font-mono text-[11.5px] text-subtle" data-testid="row-time">
        {props.time}
      </span>
    </div>
  )
}
