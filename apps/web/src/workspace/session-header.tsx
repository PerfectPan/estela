import type { SessionSummary } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { Show } from 'solid-js'
import { HostMark } from '@/browser/host-mark.tsx'
import { WarningIcon } from '@/components/icons.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { formatDuration, formatNumber, formatOptional, formatStart, formatTokens } from '@/lib/format.ts'
import { hostName } from '@/lib/host-names.ts'

/**
 * Host, working directory, start time, title, and the seven numbers from `fold` (3.6).
 * A number whose capability the host does not declare is `undefined` and shows "—".
 */
const dash = () => t('common.dash')

export function SessionHeader(props: { trace: Trace, summary: SessionSummary }) {
  const num = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const tokens = () => {
    const input = formatOptional(props.summary.tokensIn, formatTokens, dash())
    const output = formatOptional(props.summary.tokensOut, formatTokens, dash())
    return input === dash() && output === dash() ? dash() : `${input} / ${output}`
  }
  const started = () => props.trace.session.startedAt ?? props.trace.events[0]?.ts
  const failed = () => props.summary.failedTools ?? 0
  return (
    <section class="flex shrink-0 items-end justify-between gap-8 border-b border-border px-5 pt-5 pb-4" aria-label={props.trace.session.title}>
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex min-w-0 items-center gap-2.5 text-[13px] text-muted-foreground">
          <HostMark id={props.trace.host.id} />
          <span class="shrink-0">{hostName(props.trace.host.id)}</span>
          <Show when={props.trace.session.cwd}>
            {cwd => (
              <>
                <span class="text-subtle">·</span>
                <span class="min-w-0 truncate font-mono text-[12px]" title={cwd()}>{cwd()}</span>
              </>
            )}
          </Show>
          <Show when={started()}>
            {ts => (
              <>
                <span class="text-subtle">·</span>
                <span class="shrink-0">{formatStart(ts(), locale())}</span>
              </>
            )}
          </Show>
        </div>
        <h1 class="m-0 truncate text-[26px] leading-[1.25] font-semibold tracking-[-0.02em]">
          {props.trace.session.title || props.trace.session.id}
        </h1>
      </div>
      <dl class="m-0 flex shrink-0 gap-[34px]">
        <Metric value={formatOptional(props.summary.durationMs, v => formatDuration(v, locale()), dash())} label={t('workspace.duration')} />
        <Metric value={num(props.summary.turns)} label={t('workspace.turns')} />
        <Metric value={num(props.summary.requests)} label={t('workspace.requests')} />
        <Metric value={tokens()} label={t('workspace.tokensInOut')} />
        <Metric value={num(props.summary.compactions)} label={t(props.summary.compactions === 1 ? 'workspace.compaction' : 'workspace.compactions')} />
        <Metric value={num(props.summary.subagents)} label={t('workspace.subagents')} />
        <Metric value={num(props.summary.failedTools)} label={t('workspace.failedTools')} failed={failed() > 0} />
      </dl>
    </section>
  )
}

function Metric(props: { value: string, label: string, failed?: boolean }) {
  return (
    <div class="flex flex-col-reverse gap-[3px]">
      <dt class="text-[11.5px] whitespace-nowrap text-subtle">{props.label}</dt>
      <dd class={cx('m-0 flex items-center gap-1.5 font-mono text-[15px] font-medium whitespace-nowrap', props.failed ? 'text-destructive' : 'text-foreground')}>
        <Show when={props.failed}><WarningIcon /></Show>
        {props.value}
      </dd>
    </div>
  )
}
