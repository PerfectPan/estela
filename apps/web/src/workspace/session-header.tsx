import type { SessionSummary } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { Show } from 'solid-js'
import { HostMark } from '@/browser/host-mark.tsx'
import { Metric } from '@/components/metric.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { escapeBidi } from '@/lib/preview.ts'
import { formatDuration, formatInOut, formatNumber, formatOptional, formatStart } from '@/lib/format.ts'
import { hostName } from '@/lib/host-names.ts'

/**
 * Host, working directory, start time, title, and the seven numbers from `fold` (3.6).
 * A number whose capability the host does not declare is `undefined` and shows "—".
 */
const dash = () => t('common.dash')

export function SessionHeader(props: { trace: Trace, summary: SessionSummary }) {
  const num = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const tokens = () => formatInOut(props.summary.tokensIn, props.summary.tokensOut, dash())
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
                <span class="min-w-0 truncate font-mono text-[12px] [unicode-bidi:isolate]" dir="auto" title={cwd()}>{escapeBidi(cwd())}</span>
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
        <h1 class="m-0 truncate text-[26px] leading-[1.25] font-semibold tracking-[-0.02em] [unicode-bidi:isolate]" dir="auto">
          {escapeBidi(props.trace.session.title || props.trace.session.id)}
        </h1>
      </div>
      <dl class="m-0 flex shrink-0 gap-[34px]">
        <Metric term value={formatOptional(props.summary.durationMs, v => formatDuration(v, locale()), dash())} label={t('workspace.duration')} />
        <Metric term value={num(props.summary.turns)} label={t('workspace.turns')} />
        <Metric term value={num(props.summary.requests)} label={t('workspace.requests')} />
        <Metric term value={tokens()} label={t('workspace.tokensInOut')} />
        <Metric term value={num(props.summary.compactions)} label={t(props.summary.compactions === 1 ? 'workspace.compaction' : 'workspace.compactions')} />
        <Metric term value={num(props.summary.subagents)} label={t('workspace.subagents')} />
        <Metric term value={num(props.summary.failedTools)} label={t('workspace.failedTools')} failed={failed() > 0} />
      </dl>
    </section>
  )
}
