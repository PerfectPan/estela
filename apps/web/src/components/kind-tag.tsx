import type { LedgerKind } from '@/lib/ledger'
import { KIND_LABEL } from '@/lib/ledger'
import { cx } from '@/lib/cva'

const KIND_CLASS: Record<LedgerKind, string> = {
  system: 'bg-muted text-muted-foreground',
  user: 'bg-[var(--traj-user-bg)] text-[var(--traj-user-fg)]',
  assistant: 'bg-[var(--traj-assistant-bg)] text-[var(--traj-assistant-fg)]',
  thinking: 'bg-muted text-muted-foreground',
  tool: 'bg-[var(--traj-tool-bg)] text-[var(--traj-tool-fg)]',
  compacted: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
}

export function KindTag(props: { kind: LedgerKind, class?: string }) {
  return (
    <span
      class={cx(
        'inline-flex h-[22px] max-w-full items-center rounded-[6px] px-1 text-[12px] font-medium leading-none whitespace-nowrap',
        KIND_CLASS[props.kind],
        props.class,
      )}
    >
      {KIND_LABEL[props.kind]}
    </span>
  )
}
