import type { LaneDraw } from './timeline-data.ts'
import type { TimeScale } from '@/lib/timeline-scale.ts'
import { For, Show, createMemo } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'
import { formatTokens } from '@/lib/format.ts'
import { barHolding, bucketBars, tokenGrid, xOf } from '@/lib/timeline-scale.ts'
import { LAYOUT } from './timeline-layout.ts'
import { FailedMarks } from './failed-marks.tsx'

/** Requests closer than this many px share one bar. */
const BAR_GAP = 3.5

function barHeight(tokens: number, top: number): number {
  return top > 0 ? Math.max(1, (tokens / top) * LAYOUT.barMax) : 0
}

export function MainLane(props: {
  draw: LaneDraw
  scale: TimeScale
  top: number
  selectedId?: string
  compareId?: string
}) {
  const bars = createMemo(() => bucketBars(props.draw.bars, props.scale, BAR_GAP))
  const tools = createMemo(() => bucketBars(props.draw.tools, props.scale, 4))
  const grid = createMemo(() => tokenGrid(props.top))
  const barOf = (id: string | undefined) => barHolding(bars(), props.draw.bars, id, props.scale, BAR_GAP)
  const selected = createMemo(() => barOf(props.selectedId))
  const compared = createMemo(() => (props.compareId === props.selectedId ? undefined : barOf(props.compareId)))
  const ringHeight = (bar: { tokens?: number }) =>
    bar.tokens !== undefined && props.top > 0 ? barHeight(bar.tokens, props.top) : 10
  return (
    <g>
      <text x={LAYOUT.labelX} y="44" class="font-sans" font-size="12" fill="var(--muted-foreground)">
        {t('timeline.mainAgent')}
      </text>
      <text x={LAYOUT.labelX} y="60" class="font-mono" font-size="10" fill="var(--subtle-foreground)">
        {t('timeline.contextTokens')}
      </text>
      <For each={grid()}>
        {value => {
          const y = () => LAYOUT.baseline - barHeight(value, props.top)
          return (
            <>
              <line
                x1={props.scale.x0}
                y1={y()}
                x2={props.scale.x1}
                y2={y()}
                stroke="var(--border)"
                stroke-dasharray="2 4"
              />
              <text
                x={props.scale.x0 - 8}
                y={y() + 3}
                text-anchor="end"
                class="font-mono"
                font-size="9.5"
                fill="var(--subtle-foreground)"
              >
                {formatTokens(value)}
              </text>
            </>
          )
        }}
      </For>
      <line x1={props.scale.x0} y1={LAYOUT.baseline} x2={props.scale.x1} y2={LAYOUT.baseline} stroke="var(--input)" />
      <For each={bars()}>
        {bar => (
          <Show
            when={bar.tokens !== undefined && props.top > 0}
            fallback={
              <rect
                x={bar.x - 1.5}
                y={LAYOUT.baseline - 10}
                width="3"
                height="10"
                rx="1"
                fill="none"
                stroke="var(--kind-request)"
                stroke-width="1"
                data-hollow="true"
              />
            }
          >
            <rect
              x={bar.x - 1.5}
              y={LAYOUT.baseline - barHeight(bar.tokens!, props.top)}
              width="3"
              height={barHeight(bar.tokens!, props.top)}
              rx="1"
              fill="var(--kind-request)"
              data-marker="request"
            />
          </Show>
        )}
      </For>
      <For each={tools()}>
        {tool => (
          <rect
            x={tool.x - 1.5}
            y={LAYOUT.toolY}
            width={Math.min(6, 2 + tool.count)}
            height="4"
            rx="1"
            fill="var(--kind-tool)"
          />
        )}
      </For>
      <For each={props.draw.prompts}>
        {prompt => (
          <circle
            cx={xOf(props.scale, prompt.ts)}
            cy={LAYOUT.promptY}
            r="4"
            fill="var(--kind-user)"
            data-marker="prompt"
          />
        )}
      </For>
      <FailedMarks marks={props.draw.failed} scale={props.scale} y={LAYOUT.failedY} />
      <Show when={compared()}>
        {bar => (
          <rect
            x={bar().x - 4}
            y={LAYOUT.baseline - ringHeight(bar()) - 2.5}
            width="8"
            height={ringHeight(bar()) + 5.5}
            rx="2"
            fill="none"
            stroke="var(--muted-foreground)"
            stroke-width="1.25"
            stroke-dasharray="2 2"
            data-testid="compare-ring"
          />
        )}
      </Show>
      <Show when={selected()}>
        {bar => {
          const h = () => ringHeight(bar())
          return (
            <rect
              x={bar().x - 4}
              y={LAYOUT.baseline - h() - 2.5}
              width="8"
              height={h() + 5.5}
              rx="2"
              fill="none"
              stroke="var(--foreground)"
              stroke-width="1.5"
            />
          )
        }}
      </Show>
    </g>
  )
}
