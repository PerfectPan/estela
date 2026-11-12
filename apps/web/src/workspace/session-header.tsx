import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { TraceCost } from '@rivus/estela-kernel'
import type { Trace } from '@rivus/estela-schema'
import { Show } from 'solid-js'
import { AgentMark } from '@/browser/agent-mark.tsx'
import { Metric } from '@/components/metric.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { escapeBidi } from '@/lib/preview.ts'
import { formatDuration, formatInOut, formatNumber, formatOptional, formatPercent, formatStart } from '@/lib/format.ts'
import { agentName } from '@/lib/agent-names.ts'
import { costBasisText, costHeadline, totalCostDetail } from '@/lib/cost-text.ts'

/**
 * Agent, working directory, start time, title, the seven numbers from `fold`, and the list cost.
 * A number whose capability the agent does not declare is `undefined` and shows "—".
 */
const dash = () => t('common.dash')

export function SessionHeader(props: { trace: Trace; summary: SessionSummary; cost: TraceCost }) {
  const num = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const tokens = () => formatInOut(props.summary.inputTokens, props.summary.outputTokens, dash())
  const started = () => props.trace.session.startedAt ?? props.trace.events[0]?.ts
  const failed = () => props.summary.failedTools ?? 0
  const cost = () => costHeadline(props.cost.total)
  // A complete sum's label carries the cache hit rate; a partial or missing one says what is missing instead.
  const costLabel = () => {
    const rate = props.cost.total.cacheHitRate
    const note =
      cost().note ?? (rate === undefined ? undefined : t('cost.hitRate', { value: formatPercent(rate, locale()) }))
    return note ? `${t('cost.label')} · ${note}` : t('cost.label')
  }
  const costTitle = () => [costBasisText(props.cost.version), ...totalCostDetail(props.cost.total)].join('\n')
  return (
    <section
      class="flex shrink-0 items-end justify-between gap-8 border-b border-border px-5 pt-5 pb-4"
      aria-label={props.trace.session.title}
    >
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex min-w-0 items-center gap-2.5 text-[13px] text-muted-foreground">
          <AgentMark id={props.trace.agent} />
          <span class="shrink-0">{agentName(props.trace.agent)}</span>
          <Show when={props.trace.session.cwd}>
            {cwd => (
              <>
                <span class="text-subtle">·</span>
                <span class="min-w-0 truncate font-mono text-[12px] [unicode-bidi:isolate]" dir="auto" title={cwd()}>
                  {escapeBidi(cwd())}
                </span>
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
        <h1
          class="m-0 truncate text-[26px] leading-[1.25] font-semibold tracking-[-0.02em] [unicode-bidi:isolate]"
          dir="auto"
        >
          {escapeBidi(props.trace.session.title || props.trace.session.id)}
        </h1>
      </div>
      <dl class="m-0 flex shrink-0 gap-[34px]">
        <Metric
          term
          value={formatOptional(props.summary.durationMs, v => formatDuration(v, locale()), dash())}
          label={t('workspace.duration')}
        />
        <Metric term value={num(props.summary.turns)} label={t('workspace.turns')} />
        <Metric term value={num(props.summary.requests)} label={t('workspace.requests')} />
        <Metric term value={tokens()} label={t('workspace.tokensInOut')} />
        <Metric
          term
          value={num(props.summary.compactions)}
          label={t(props.summary.compactions === 1 ? 'workspace.compaction' : 'workspace.compactions')}
        />
        <Metric term value={num(props.summary.subagents)} label={t('workspace.subagents')} />
        <Metric term value={num(props.summary.failedTools)} label={t('workspace.failedTools')} failed={failed() > 0} />
        <Metric
          term
          value={cost().value}
          label={costLabel()}
          muted={cost().unavailable}
          title={costTitle()}
          testId="session-cost"
        />
      </dl>
    </section>
  )
}
