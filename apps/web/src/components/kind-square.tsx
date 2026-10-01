import type { RowKind } from '@/lib/ledger-model.ts'
import { cx } from '@/lib/cva'

/**
 * Kind is a mark, not text color (docs/design/README.md). The five palette kinds are filled
 * squares; assistant replies are a neutral outlined square; the rest are neutral.
 */
const MARK: Record<RowKind, string> = {
  user: 'bg-kind-user',
  request: 'bg-kind-request',
  tool: 'bg-kind-tool',
  thinking: 'bg-kind-thinking',
  subagent: 'bg-kind-subagent',
  reply: 'border border-subtle',
  system: 'bg-subtle',
  hook: 'bg-subtle',
  compaction: 'border border-foreground',
  unknown: 'border border-subtle border-dashed',
}

export function KindSquare(props: { kind: RowKind; size?: 'row' | 'title'; class?: string }) {
  return (
    <span
      class={cx(
        'box-border shrink-0 rounded-[2px]',
        props.size === 'title' ? 'size-[9px]' : 'size-[7px]',
        MARK[props.kind],
        props.class,
      )}
      aria-hidden="true"
    />
  )
}
