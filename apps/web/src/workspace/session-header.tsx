import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { TraceCost } from '@rivus/estela-kernel'
import type { Trace } from '@rivus/estela-schema'
import { Show } from 'solid-js'
import { AgentMark } from '@/browser/agent-mark.tsx'
import { Metric } from '@/components/metric.tsx'
import type { MessageKey } from '@/i18n/locale.ts'
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
/** The singular label for exactly one; a count the agent does not record ("—") keeps the plural. */
const countLabel = (count: number | undefined, one: MessageKey, many: MessageKey) => t(count === 1 ? one : many)

export function SessionHeader(props: {
  trace: Trace
  summary: SessionSummary
  cost: TraceCost
  embedded?: boolean
  onJump?: () => void
}) {
  const num = (value: number | undefined) => formatOptional(value, v => formatNumber(v, locale()), dash())
  const duration = () => formatOptional(props.summary.durationMs, v => formatDuration(v, locale()), dash())
  const tokens = () => formatInOut(props.summary.inputTokens, props.summary.outputTokens, dash())
  const started = () => props.trace.session.startedAt ?? props.trace.events[0]?.ts
  const failed = () => props.summary.failedTools ?? 0
  const compactions = () => props.summary.compactions ?? 0
  const subagents = () => props.summary.subagents ?? 0
  const cost = () => costHeadline(props.cost.total)
  // A complete sum's label carries the cache hit rate; a partial or missing one says what is missing instead.
  const costLabel = () => {
    const rate = props.cost.total.cacheHitRate
    const note =
      cost().note ?? (rate === undefined ? undefined : t('cost.hitRate', { value: formatPercent(rate, locale()) }))
    return note ? `${t('cost.label')} · ${note}` : t('cost.label')
  }
  const costTitle = () => [costBasisText(props.cost.version), ...totalCostDetail(props.cost.total)].join('\n')
  const metrics = (compact: boolean) => (
    <>
      <Metric term compact={compact} value={duration()} label={t('workspace.duration')} />
      <Metric
        term
        compact={compact}
        value={num(props.summary.turns)}
        label={countLabel(props.summary.turns, 'workspace.turn', 'workspace.turns')}
      />
      <Metric
        term
        compact={compact}
        value={num(props.summary.requests)}
        label={countLabel(props.summary.requests, 'workspace.request', 'workspace.requests')}
      />
      <Metric term compact={compact} value={tokens()} label={t('workspace.tokensInOut')} />
      <Show when={!compact || compactions() > 0}>
        <Metric
          term
          compact={compact}
          value={num(props.summary.compactions)}
          label={countLabel(props.summary.compactions, 'workspace.compaction', 'workspace.compactions')}
        />
      </Show>
      <Show when={!compact || subagents() > 0}>
        <Metric
          term
          compact={compact}
          value={num(props.summary.subagents)}
          label={countLabel(props.summary.subagents, 'workspace.subagent', 'workspace.subagents')}
        />
      </Show>
      <Show when={!compact || failed() > 0}>
        <Metric
          term
          compact={compact}
          value={num(props.summary.failedTools)}
          label={countLabel(props.summary.failedTools, 'workspace.failedTool', 'workspace.failedTools')}
          failed={failed() > 0}
        />
      </Show>
      <Metric
        term
        compact={compact}
        value={cost().value}
        label={costLabel()}
        muted={cost().unavailable}
        title={costTitle()}
        testId="session-cost"
      />
    </>
  )
  return (
    <Show
      when={props.embedded}
      fallback={
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
                    <span
                      class="min-w-0 truncate font-mono text-[12px] [unicode-bidi:isolate]"
                      dir="auto"
                      title={cwd()}
                    >
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
          <dl class="m-0 flex shrink-0 gap-[34px]">{metrics(false)}</dl>
        </section>
      }
    >
      <section
        class="flex min-h-[38px] shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-1.5"
        aria-label={props.trace.session.title || t('common.session')}
        data-testid="embedded-header"
      >
        <dl class="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1">{metrics(true)}</dl>
        <Show when={props.onJump}>
          <button
            type="button"
            class="flex h-[26px] shrink-0 items-center gap-2 rounded-[var(--radius)] border border-input bg-background px-2.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('common.goToEvents')}
            data-testid="jump-to"
            onClick={() => props.onJump?.()}
          >
            <span>{t('common.goToEvents')}</span>
            <kbd class="rounded border border-input px-1 py-px font-mono text-[10.5px] leading-none text-subtle">
              ⌘K
            </kbd>
          </button>
        </Show>
      </section>
    </Show>
  )
}
