import type { JSX } from 'solid-js'
import type { Entry, LedgerModel, TurnGroup } from '@/lib/ledger-model.ts'
import { Match, Show, Switch } from 'solid-js'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CompactIcon, EyeIcon, HooksIcon, WarningIcon } from '@/components/icons.tsx'
import { KindMark } from '@/components/kind-mark.tsx'
import { locale, plural, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { isShortened, numberField, rowText, toolTarget } from '@/lib/event-text.ts'
import { elapsedFrom, formatDuration, formatNumber, formatTokens } from '@/lib/format.ts'
import { isFailedResult } from '@/lib/ledger-model.ts'
import { previewText } from '@/lib/preview.ts'

export interface RowContext {
  model: LedgerModel
  /** Session start, for the elapsed time column. */
  start: number
  dim: boolean
}

const dash = () => t('common.dash')

function elapsed(ts: number | undefined, ctx: RowContext): string {
  return elapsedFrom(ts, ctx.start)
}

/** Base row: 36 px, number, kind, content, status, metric (164 px, sized for zh-CN), time. */
function RowFrame(props: {
  ordinal?: number
  kind: Parameters<typeof KindMark>[0]['kind']
  depth: 0 | 1
  dimmed: boolean
  lane?: boolean
  children: JSX.Element
  /** After the content, outside its ellipsis, so it stays visible (S12). */
  marker?: JSX.Element
  status?: JSX.Element
  metric?: string
  time: string
}) {
  return (
    <div
      class={cx(
        'flex h-full items-center gap-3.5 border-b border-border pr-4',
        props.depth === 1 ? 'pl-11' : 'pl-5',
        props.dimmed && 'opacity-45',
      )}
    >
      <Show when={props.depth === 1}>
        <span class={cx('-ml-6 h-full w-0.5 shrink-0', props.lane ? 'bg-kind-subagent/60' : 'bg-input')} aria-hidden="true" />
      </Show>
      <span class="w-[30px] shrink-0 font-mono text-[11px] text-subtle">{props.ordinal || ''}</span>
      <KindMark kind={props.kind} />
      <div class="min-w-0 flex-1 truncate text-[13px] text-foreground [unicode-bidi:isolate]" dir="auto">{props.children}</div>
      {props.marker}
      {props.status}
      <span class="w-[164px] shrink-0 truncate text-right font-mono text-[11.5px] text-muted-foreground">{props.metric ?? ''}</span>
      <span class="w-[52px] shrink-0 text-right font-mono text-[11.5px] text-subtle">{props.time}</span>
    </div>
  )
}

function Shortened() {
  return (
    <span class="inline-flex shrink-0 rounded border border-input px-1.5 align-[1px] text-[10.5px] leading-[15px] text-muted-foreground" data-testid="shortened">
      {t('ledger.shortened')}
    </span>
  )
}

function ToolStatus(props: { result?: Parameters<typeof isFailedResult>[0] }) {
  const code = () => numberField(props.result, 'exitCode')
  return (
    <Switch>
      <Match when={isFailedResult(props.result)}>
        <span class="flex shrink-0 items-center gap-[5px] text-[12px] text-destructive" data-testid="failed-tool">
          <WarningIcon size={13} />
          <span class="font-mono">{code() !== undefined ? t('ledger.exit', { code: code()! }) : t('ledger.failed')}</span>
        </span>
      </Match>
      <Match when={code() === 0}>
        <span class="flex shrink-0 items-center gap-[5px] text-[12px] text-muted-foreground">
          <CheckIcon size={13} class="text-kind-user" />
          <span class="font-mono">{t('ledger.exit', { code: 0 })}</span>
        </span>
      </Match>
    </Switch>
  )
}

export function EventRow(props: { entry: Extract<Entry, { type: 'event' }>, depth: 0 | 1, ctx: RowContext, lane?: boolean }) {
  const event = () => props.ctx.model.byId.get(props.entry.eventId)!
  const result = () => props.entry.resultId ? props.ctx.model.byId.get(props.entry.resultId) : undefined
  const text = () => rowText(event())
  const metric = () => {
    const current = event()
    const request = props.ctx.model.requests.get(current.id)?.entry
    if (request) {
      if (request.inputTokens === undefined && request.outputTokens === undefined)
        return dash()
      return t('ledger.inOut', {
        input: request.inputTokens === undefined ? dash() : formatTokens(request.inputTokens),
        output: request.outputTokens === undefined ? dash() : formatTokens(request.outputTokens),
      })
    }
    const duration = numberField(result(), 'durationMs') ?? numberField(current, 'durationMs')
    return duration === undefined ? '' : formatDuration(duration, locale())
  }
  const hidden = () => props.ctx.dim && (props.ctx.model.hidden.has(props.entry.eventId) || (props.entry.resultId !== undefined && props.ctx.model.hidden.has(props.entry.resultId)))
  return (
    <RowFrame
      ordinal={props.entry.ordinal}
      kind={props.entry.kind}
      depth={props.depth}
      lane={props.lane}
      dimmed={hidden()}
      status={props.entry.kind === 'tool' ? <ToolStatus result={result()} /> : undefined}
      marker={isShortened(event()) || isShortened(result()) ? <Shortened /> : undefined}
      metric={metric()}
      time={elapsed(event().ts, props.ctx)}
    >
      <Show when={text().text}>
        <span class={text().muted ? 'text-thinking-text' : undefined}>{text().text}</span>
      </Show>
      <Show when={text().mono}>
        <span class="ml-1.5 font-mono text-[12px]">{text().mono}</span>
      </Show>
    </RowFrame>
  )
}

export function SubagentRow(props: { entry: Extract<Entry, { type: 'subagent' }>, expanded: boolean, ctx: RowContext, onToggle: () => void }) {
  const spawn = () => props.entry.eventId ? props.ctx.model.byId.get(props.entry.eventId) : undefined
  const events = () => props.entry.children.flatMap(child => child.type === 'event' ? [props.ctx.model.byId.get(child.eventId)!] : [])
  const metric = () => {
    const list = events()
    const requests = list.filter(event => event.kind === 'request').length
    const span = list.length > 1 ? list.at(-1)!.ts - list[0]!.ts : 0
    const count = requests > 0
      ? plural(requests, 'ledger.requestCountOne', 'ledger.requestCount', formatNumber(requests, locale()))
      : plural(list.length, 'ledger.eventCountOne', 'ledger.eventCount', formatNumber(list.length, locale()))
    return [count, span > 0 ? formatDuration(span, locale()) : ''].filter(Boolean).join(' · ')
  }
  const prompt = () => {
    const call = spawn()
    const target = call ? toolTarget(call.payload.args) : ''
    return target ? `“${target}”` : ''
  }
  const title = () => props.entry.title ?? props.entry.laneId
  return (
    <RowFrame
      ordinal={props.entry.ordinal}
      kind="subagent"
      depth={0}
      dimmed={props.ctx.dim && props.entry.eventId !== undefined && props.ctx.model.hidden.has(props.entry.eventId)}
      metric={metric()}
      time={elapsed(spawn()?.ts ?? events()[0]?.ts, props.ctx)}
    >
      <span>{[title(), prompt()].filter(Boolean).join(' · ')}</span>
      <button
        type="button"
        tabindex="-1"
        class="ml-2 text-[12px] text-lane-link hover:underline"
        onClick={(event) => {
          event.stopPropagation()
          props.onToggle()
        }}
      >
        {props.expanded ? t('ledger.closeLane') : t('ledger.openLane')}
      </button>
    </RowFrame>
  )
}

export function HooksRow(props: { entry: Extract<Entry, { type: 'hooks' }>, depth: 0 | 1 }) {
  return (
    <div class={cx('flex h-full items-center gap-2.5 border-b border-border pr-4 text-subtle', props.depth === 1 ? 'pl-[88px]' : 'pl-16')}>
      <HooksIcon size={13} />
      <span class="text-[12px]">{t('ledger.hooksFolded', { count: formatNumber(props.entry.count, locale()) })}</span>
    </div>
  )
}

export function CompactionRow(props: { entry: Extract<Entry, { type: 'compaction' }>, ctx: RowContext }) {
  const event = () => props.ctx.model.byId.get(props.entry.eventId)!
  const pre = () => numberField(event(), 'preTokens')
  const post = () => numberField(event(), 'postTokens')
  const stats = () => props.ctx.model.shadowed.get(props.entry.eventId)
  return (
    <div class="compaction-stripes flex h-full items-center gap-3 border-b border-border pr-4 pl-5" data-testid="compaction-row">
      <span class="w-[30px] shrink-0" />
      <CompactIcon size={16} class="shrink-0 text-foreground" />
      <span class="shrink-0 text-[13px] font-medium text-foreground">
        {event().payload.trigger === 'auto' ? t('ledger.autoCompacted') : t('ledger.compacted')}
      </span>
      <Show when={pre() !== undefined && post() !== undefined}>
        <span class="shrink-0 font-mono text-[12px] text-muted-foreground">{t('ledger.compactionTokens', { pre: formatTokens(pre()!), post: formatTokens(post()!) })}</span>
      </Show>
      <span class="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
        <Show when={stats()?.from !== undefined && stats()}>
          {(current) => {
            const { count, from, to } = current()
            if (count === 1)
              return t('ledger.leftViewOne', { from: from! })
            const params = { count: formatNumber(count, locale()), from: from!, to: to! }
            return from === to ? t('ledger.leftViewSingle', params) : t('ledger.leftView', params)
          }}
        </Show>
      </span>
      <span class="w-[52px] shrink-0 text-right font-mono text-[11.5px] text-subtle">{elapsed(event().ts, props.ctx)}</span>
    </div>
  )
}

/** 40 px turn header: chevron, "Turn N", the prompt, the hidden badge, requests and duration. */
export function TurnHeader(props: { group: TurnGroup, number?: number, collapsed: boolean, ctx: RowContext, onToggle: () => void }) {
  const prompt = () => {
    const id = props.group.turn.promptEventId
    const text = id ? props.ctx.model.byId.get(id)?.payload.text : undefined
    return typeof text === 'string' && text.trim() ? `“${previewText(text)}”` : ''
  }
  const totals = () => {
    const turn = props.group.turn.totals
    return [
      plural(turn.requests, 'ledger.requestCountOne', 'ledger.requestCount', formatNumber(turn.requests, locale())),
      turn.durationMs !== undefined ? formatDuration(turn.durationMs, locale()) : '',
    ].filter(Boolean).join(' · ')
  }
  return (
    <div class="flex h-full items-center gap-2.5 border-b border-border bg-secondary pr-4 pl-[18px]">
      <button
        type="button"
        tabindex="-1"
        class="grid size-[15px] shrink-0 place-items-center text-muted-foreground"
        aria-hidden="true"
        onClick={(event) => {
          event.stopPropagation()
          props.onToggle()
        }}
      >
        {props.collapsed ? <ChevronRightIcon size={15} /> : <ChevronDownIcon size={15} />}
      </button>
      <span class="min-w-[52px] shrink-0 text-[12.5px] font-semibold whitespace-nowrap text-foreground">
        {props.number === undefined ? t('ledger.beforePrompt') : t('ledger.turn', { index: props.number })}
      </span>
      <span class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground [unicode-bidi:isolate]" dir="auto">{prompt()}</span>
      <Show when={props.group.hidden > 0}>
        <span class="flex shrink-0 items-center gap-1.5 rounded-full border border-input px-[9px] py-0.5 text-[11.5px] text-muted-foreground">
          <EyeIcon size={12} class="text-subtle" />
          {t('ledger.hiddenBadge')}
        </span>
      </Show>
      <span class="shrink-0 font-mono text-[11.5px] text-subtle">{totals()}</span>
    </div>
  )
}
