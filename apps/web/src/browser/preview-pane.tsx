import type { HostListEntry, SessionListRow } from '@rivus/agent-trace-rpc'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatDuration, formatNumber, formatOptional, formatTokens, formatWhen } from '@/lib/format.ts'
import { ContextShape } from '@/browser/context-shape.tsx'
import { HostMark } from '@/browser/host-mark.tsx'

/** Right pane (340 px): the selected row's shape, headline numbers, first prompt, and "Open session". */
export function PreviewPane(props: { row?: SessionListRow, hosts: HostListEntry[], now: number, onOpen: (ref: string) => void }) {
  return (
    <aside class="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-secondary p-[22px]">
      <Show when={props.row}>
        {row => <Preview row={row()} hosts={props.hosts} now={props.now} onOpen={props.onOpen} />}
      </Show>
    </aside>
  )
}

const dash = () => t('common.dash')

function Preview(props: { row: SessionListRow, hosts: HostListEntry[], now: number, onOpen: (ref: string) => void }) {
  const num = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const tokens = (value: number | undefined) => formatOptional(value, formatTokens, dash())
  const hostName = () => props.hosts.find(host => host.id === props.row.host)?.displayName ?? props.row.host
  const when = () => props.row.lastActiveAt ? formatWhen(props.row.lastActiveAt, locale(), props.now) : ''
  const pair = (left: string, right: string) => left === dash() && right === dash() ? dash() : `${left} · ${right}`
  const inOut = () => {
    const left = tokens(props.row.tokensIn)
    const right = tokens(props.row.tokensOut)
    return left === dash() && right === dash() ? dash() : `${left} / ${right}`
  }
  const shape = () => props.row.shape ?? []

  return (
    <>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <HostMark id={props.row.host} />
          <span class="text-[12.5px] text-muted-foreground">{[hostName(), when()].filter(Boolean).join(' · ')}</span>
        </div>
        <h2 class="m-0 text-[19px] font-semibold leading-[1.3] tracking-[-0.01em] [overflow-wrap:anywhere]">
          {props.row.title || (props.row.error ? t('common.couldNotRead') : dash())}
        </h2>
        <Show when={props.row.cwd}>
          {cwd => <span class="data text-[12px] text-subtle [overflow-wrap:anywhere]">{cwd()}</span>}
        </Show>
      </div>
      <Show when={props.row.error}>
        {error => (
          <div class="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-[12.5px]" data-testid="read-error">
            <span class="font-semibold text-foreground">{t('common.couldNotRead')}</span>
            <Show when={error().file}>
              {file => (
                <span class="data text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">
                  {file()}
                  {error().line !== undefined ? ` · ${t('common.line', { line: error().line! })}` : ''}
                </span>
              )}
            </Show>
            <span class="text-muted-foreground [overflow-wrap:anywhere]">{error().reason}</span>
          </div>
        )}
      </Show>
      <div class="flex flex-col gap-2">
        <span class="section-label text-muted-foreground">{t('browser.shape')}</span>
        <Show
          when={shape().length > 0}
          fallback={<p class="m-0 flex h-[46px] items-center text-[12px] text-subtle">{props.row.pending ? t('browser.shapePending') : (props.row.error ? dash() : t('browser.shapeMissing'))}</p>}
        >
          <ContextShape values={shape()} label={t('browser.shape')} />
        </Show>
      </div>
      <div class="grid grid-cols-2 gap-x-3 gap-y-4">
        <Metric value={formatOptional(props.row.durationMs, v => formatDuration(v, locale()), dash())} label={t('browser.durationLabel')} />
        <Metric value={num(props.row.requests)} label={t('browser.requestsLabel')} />
        <Metric value={inOut()} label={t('browser.tokensInOut')} />
        <Metric value={pair(num(props.row.compactions), num(props.row.subagents))} label={t('browser.compactionsSubagents')} />
      </div>
      <Show when={props.row.firstPrompt}>
        {prompt => (
          <div class="flex min-h-0 flex-col gap-2">
            <span class="section-label text-muted-foreground">{t('browser.firstPrompt')}</span>
            <p class="m-0 line-clamp-[9] whitespace-pre-line text-[13.5px] leading-[1.55] text-foreground [overflow-wrap:anywhere]">{prompt()}</p>
          </div>
        )}
      </Show>
      <button
        type="button"
        class="flex h-10 shrink-0 items-center justify-center gap-2 rounded-[9px] bg-foreground text-[14px] font-semibold text-background hover:opacity-90"
        onClick={() => props.onOpen(props.row.ref)}
      >
        {t('common.openSession')}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12 H19 M13 6 L19 12 L13 18" />
        </svg>
      </button>
    </>
  )
}

function Metric(props: { value: string, label: string }) {
  return (
    <div class="flex flex-col gap-[3px]">
      <span class="data text-[15px] font-medium text-foreground">{props.value}</span>
      <span class="text-[11.5px] text-subtle">{props.label}</span>
    </div>
  )
}
