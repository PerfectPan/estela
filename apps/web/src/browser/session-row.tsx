import type { SessionListRow } from '@rivus/agent-trace-rpc'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatActive, formatDuration, formatNumber, formatOptional, formatTokens } from '@/lib/format.ts'
import { FlagIcons } from '@/browser/flag-icons.tsx'
import { HostMark } from '@/browser/host-mark.tsx'
import { COLUMNS, optionId } from '@/browser/session-list-layout.ts'
import { SessionCell } from '@/browser/session-cell.tsx'

const dash = () => t('common.dash')

/** Hover text for a "could not read" row: file, line, reason. */
function errorTitle(row: SessionListRow): string {
  const error = row.error
  if (!error) {
    return ''
  }
  const where = error.file ? `${error.file}${error.line !== undefined ? `:${error.line}` : ''}` : ''
  return [where, error.reason].filter(Boolean).join('\n')
}

export function SessionRow(props: {
  row: SessionListRow
  hostName: string
  now: number
  selected: boolean
  onSelect: (ref: string) => void
  onOpen: (ref: string) => void
}) {
  const count = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const title = () => props.row.title || (props.row.error ? t('common.couldNotRead') : dash())
  // A "could not read" row says why in the row itself, not only on hover (S4).
  const subtitle = () => {
    const error = props.row.error
    if (!error) {
      return props.row.cwd
    }
    return props.row.title ? `${t('common.couldNotRead')}: ${error.reason}` : error.reason
  }
  return (
    <div
      id={optionId(props.row.ref)}
      role="option"
      aria-selected={props.selected}
      data-ref={props.row.ref}
      data-host={props.row.host}
      title={props.row.error ? errorTitle(props.row) : undefined}
      class={`session-row flex h-[52px] cursor-default items-center gap-3.5 border-b border-border px-[18px] ${props.selected ? 'bg-selection shadow-[inset_0_0_0_1px_var(--selection-ring)]' : 'hover:bg-accent'}`}
      onClick={() => props.onSelect(props.row.ref)}
      onDblClick={() => props.onOpen(props.row.ref)}
    >
      <HostMark id={props.row.host} />
      <div class="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span
          class={`truncate text-[14px] ${props.row.error && !props.row.title ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {title()}
        </span>
        <span class="truncate text-[12px] text-subtle">
          {props.hostName}
          <Show when={subtitle()}>
            {text => (
              <>
                {' · '}
                <span class={props.row.error ? '' : 'font-mono'}>{text()}</span>
              </>
            )}
          </Show>
        </span>
      </div>
      <FlagIcons
        compactions={props.row.compactions}
        subagents={props.row.subagents}
        failedTools={props.row.failedTools}
      />
      <SessionCell class={COLUMNS.turns} text={count(props.row.turns)} />
      <SessionCell class={COLUMNS.requests} text={count(props.row.requests)} />
      <SessionCell class={COLUMNS.tokens} text={formatOptional(props.row.inputTokens, formatTokens, dash())} />
      <SessionCell
        class={COLUMNS.duration}
        text={formatOptional(props.row.durationMs, v => formatDuration(v, locale()), dash())}
      />
      <span class={`${COLUMNS.active} shrink-0 text-right text-[12.5px] text-subtle`}>
        {props.row.lastActiveAt ? formatActive(props.row.lastActiveAt, locale(), props.now) : dash()}
      </span>
    </div>
  )
}
