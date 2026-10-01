import type { LaneDraw, Mark } from './timeline-data.ts'
import type { TimeScale } from '@/lib/timeline-scale.ts'
import { For, Show, createMemo } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatDuration, formatTokens } from '@/lib/format.ts'
import { escapeBidi } from '@/lib/preview.ts'
import { axisTicks, bucketBars, tokenGrid, xOf } from '@/lib/timeline-scale.ts'

/** Pixel layout from docs/design/session-workspace-*.html (1440 px wide, 166 px tall with two subagent lanes). */
export const LAYOUT = {
  labelX: 20,
  /** Plot start; the label column grows past it for long lane titles, up to `maxX0`. */
  x0: 148,
  maxX0: 280,
  right: 36,
  baseline: 74,
  barMax: 52,
  toolY: 77,
  promptY: 90,
  failedY: 83,
  firstLane: 104,
  laneStep: 26,
  maxSubLanes: 6,
  handleY: 90,
} as const

/** Bottom of the lane area: the axis starts 14 px below the last lane. */
export function axisTop(lanes: number, extra: boolean): number {
  const rows = lanes + (extra ? 1 : 0)
  return rows === 0 ? LAYOUT.firstLane - 4 : LAYOUT.firstLane + LAYOUT.laneStep * (rows - 1) + 14
}

function barHeight(tokens: number, top: number): number {
  return top > 0 ? Math.max(1, (tokens / top) * LAYOUT.barMax) : 0
}

export function MainLane(props: { draw: LaneDraw, scale: TimeScale, top: number, selectedId?: string }) {
  const bars = createMemo(() => bucketBars(props.draw.bars, props.scale, 3.5))
  const tools = createMemo(() => bucketBars(props.draw.tools, props.scale, 4))
  const grid = createMemo(() => tokenGrid(props.top))
  const selected = createMemo(() => {
    const id = props.selectedId
    return id ? bars().find(bar => bar.id === id) : undefined
  })
  return (
    <g>
      <text x={LAYOUT.labelX} y="44" class="font-sans" font-size="12" fill="var(--muted-foreground)">{t('timeline.mainAgent')}</text>
      <text x={LAYOUT.labelX} y="60" class="font-mono" font-size="10" fill="var(--subtle-foreground)">{t('timeline.contextTokens')}</text>
      <For each={grid()}>
        {(value) => {
          const y = () => LAYOUT.baseline - barHeight(value, props.top)
          return (
            <>
              <line x1={props.scale.x0} y1={y()} x2={props.scale.x1} y2={y()} stroke="var(--border)" stroke-dasharray="2 4" />
              <text x={props.scale.x0 - 8} y={y() + 3} text-anchor="end" class="font-mono" font-size="9.5" fill="var(--subtle-foreground)">{formatTokens(value)}</text>
            </>
          )
        }}
      </For>
      <line x1={props.scale.x0} y1={LAYOUT.baseline} x2={props.scale.x1} y2={LAYOUT.baseline} stroke="var(--input)" />
      <For each={bars()}>
        {bar => (
          <Show
            when={bar.tokens !== undefined && props.top > 0}
            fallback={<rect x={bar.x - 1.5} y={LAYOUT.baseline - 10} width="3" height="10" rx="1" fill="none" stroke="var(--kind-request)" stroke-width="1" data-hollow="true" />}
          >
            <rect x={bar.x - 1.5} y={LAYOUT.baseline - barHeight(bar.tokens!, props.top)} width="3" height={barHeight(bar.tokens!, props.top)} rx="1" fill="var(--kind-request)" data-marker="request" />
          </Show>
        )}
      </For>
      <For each={tools()}>
        {tool => <rect x={tool.x - 1.5} y={LAYOUT.toolY} width={Math.min(6, 2 + tool.count)} height="4" rx="1" fill="var(--kind-tool)" />}
      </For>
      <For each={props.draw.prompts}>
        {prompt => <circle cx={xOf(props.scale, prompt.ts)} cy={LAYOUT.promptY} r="4" fill="var(--kind-user)" data-marker="prompt" />}
      </For>
      <FailedMarks marks={props.draw.failed} scale={props.scale} y={LAYOUT.failedY} />
      <Show when={selected()}>
        {bar => {
          const h = () => bar().tokens !== undefined ? barHeight(bar().tokens!, props.top) : 10
          return <rect x={bar().x - 4} y={LAYOUT.baseline - h() - 2.5} width="8" height={h() + 5.5} rx="2" fill="none" stroke="var(--foreground)" stroke-width="1.5" />
        }}
      </Show>
    </g>
  )
}

function FailedMarks(props: { marks: Mark[], scale: TimeScale, y: number, size?: number }) {
  const half = () => (props.size ?? 9) / 2
  return (
    <For each={props.marks}>
      {mark => (
        <path
          d={`M${xOf(props.scale, mark.ts)} ${props.y} l${half()} ${half() * 1.55} h${-half() * 2} z`}
          fill="var(--destructive)"
          data-marker="failed-tool"
        />
      )}
    </For>
  )
}

export function SubLane(props: { draw: LaneDraw, index: number, scale: TimeScale, fit: (text: string, width: number) => string }) {
  const y = () => LAYOUT.firstLane + LAYOUT.laneStep * props.index
  const bars = createMemo(() => bucketBars(props.draw.bars, props.scale, 5))
  const title = () => escapeBidi(props.draw.lane.title ?? props.draw.lane.id)
  const label = () => props.fit(title(), props.scale.x0 - LAYOUT.labelX - 12)
  const span = () => {
    const { from, to } = props.draw
    if (from === undefined || to === undefined)
      return undefined
    const x = xOf(props.scale, from)
    return { x, width: Math.max(4, xOf(props.scale, to) - x) }
  }
  return (
    <g data-lane={props.draw.lane.id}>
      <text x={LAYOUT.labelX} y={y() + 4} class="font-sans" font-size="12" fill="var(--muted-foreground)">
        <title>{title()}</title>
        {label()}
      </text>
      <line x1={props.scale.x0} y1={y()} x2={props.scale.x1} y2={y()} stroke="var(--border)" />
      <Show when={span()}>
        {box => <rect x={box().x} y={y() - 7} width={box().width} height="14" rx="3" fill="var(--kind-subagent)" fill-opacity="0.22" />}
      </Show>
      <For each={bars()}>
        {bar => <rect x={bar.x} y={y() - 4} width={Math.min(7, 3 + bar.count)} height="8" rx="2" fill="var(--kind-subagent)" />}
      </For>
      <Show when={props.draw.spawn}>
        {spawn => <path d={`M${xOf(props.scale, spawn().ts)} 82 V${y() - 7}`} stroke="var(--kind-subagent)" stroke-width="1" stroke-dasharray="2 3" />}
      </Show>
      <FailedMarks marks={props.draw.failed} scale={props.scale} y={y() - 13} size={7} />
    </g>
  )
}

/** `0m` / `0分` on a minute axis, `0s` / `0秒` on a seconds axis. */
function zeroLabel(step: number): string {
  return formatDuration(step >= 60_000 ? 60_000 : 1000, locale()).replace(/\d+/, '0')
}

export function Axis(props: { scale: TimeScale, top: number }) {
  const ticks = createMemo(() => axisTicks(props.scale, Math.max(2, Math.floor((props.scale.x1 - props.scale.x0) / 96))))
  return (
    <For each={ticks()}>
      {(at) => {
        const x = () => xOf(props.scale, props.scale.start + at)
        return (
          <>
            <line x1={x()} y1={props.top} x2={x()} y2={props.top + 4} stroke="var(--input)" />
            <text x={x()} y={props.top + 16} text-anchor="middle" class="font-mono" font-size="10" fill="var(--subtle-foreground)">
              {at === 0 ? zeroLabel(ticks()[1] ?? 1000) : formatDuration(at, locale())}
            </text>
          </>
        )
      }}
    </For>
  )
}
