import type { RowKind } from '@/lib/ledger-model.ts'
import type { MessageKey } from '@/i18n/locale.ts'
import { translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'

const KIND_LABEL: Record<RowKind, MessageKey> = {
  user: 'common.kinds.user',
  request: 'common.kinds.request',
  tool: 'common.kinds.tool',
  thinking: 'common.kinds.thinking',
  reply: 'common.kinds.reply',
  subagent: 'common.kinds.subagent',
  system: 'common.kinds.system',
  hook: 'common.kinds.hook',
  compaction: 'common.kinds.compaction',
  unknown: 'common.kinds.unknown',
}

export const KIND_TITLE: Record<RowKind, MessageKey> = {
  user: 'inspector.titles.user',
  request: 'inspector.titles.request',
  tool: 'inspector.titles.tool',
  thinking: 'inspector.titles.thinking',
  reply: 'inspector.titles.reply',
  subagent: 'inspector.titles.subagent',
  system: 'inspector.titles.system',
  hook: 'inspector.titles.hook',
  compaction: 'inspector.titles.compaction',
  unknown: 'inspector.titles.unknown',
}

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

/** The ledger's kind column: mark plus label, 86 px. */
export function KindMark(props: { kind: RowKind }) {
  return (
    <span class="flex w-[86px] shrink-0 items-center gap-[7px]">
      <KindSquare kind={props.kind} />
      <span class="kind-label truncate text-muted-foreground">{t(KIND_LABEL[props.kind])}</span>
    </span>
  )
}
