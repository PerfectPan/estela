import type { LedgerKind } from '@/lib/ledger'
import type { MessageKey } from '@/i18n/locale.ts'
import { translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'

const KIND_KEY: Record<LedgerKind, MessageKey> = {
  system: 'common.kinds.system',
  user: 'common.kinds.user',
  assistant: 'common.kinds.assistant',
  thinking: 'common.kinds.thinking',
  tool: 'common.kinds.tool',
  compacted: 'common.kinds.compacted',
  request: 'common.kinds.request',
  hook: 'common.kinds.hook',
  unknown: 'common.kinds.unknown',
}

/** Kind is a mark, not text color (docs/design/README.md). Assistant replies use an outlined square. */
const KIND_MARK: Record<LedgerKind, string> = {
  system: 'bg-subtle',
  user: 'bg-kind-user',
  assistant: 'border border-muted-foreground',
  thinking: 'bg-kind-thinking',
  tool: 'bg-kind-tool',
  compacted: 'bg-subtle',
  request: 'bg-kind-request',
  hook: 'bg-subtle',
  unknown: 'border border-subtle',
}

export function KindTag(props: { kind: LedgerKind, class?: string }) {
  return (
    <span
      class={cx(
        'inline-flex h-[22px] max-w-full items-center gap-1.5 text-[11.5px] font-medium leading-none whitespace-nowrap text-muted-foreground',
        props.class,
      )}
    >
      <span class={cx('size-2 shrink-0 rounded-[2px]', KIND_MARK[props.kind])} aria-hidden="true" />
      {t(KIND_KEY[props.kind])}
    </span>
  )
}
