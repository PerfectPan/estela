import type { LaneDraw } from './timeline-data.ts'
import type { TimeScale } from '@/lib/timeline-scale.ts'
import { For, Show, createMemo } from 'solid-js'
import { escapeBidi } from '@/lib/preview.ts'
import { bucketBars, xOf } from '@/lib/timeline-scale.ts'
import { LAYOUT } from './timeline-layout.ts'
import { FailedMarks } from './failed-marks.tsx'

export function SubLane(props: {
  draw: LaneDraw
  index: number
  scale: TimeScale
  fit: (text: string, width: number) => string
}) {
  const y = () => LAYOUT.firstLane + LAYOUT.laneStep * props.index
  const bars = createMemo(() => bucketBars(props.draw.bars, props.scale, 5))
  const title = () => escapeBidi(props.draw.lane.title ?? props.draw.lane.id)
  const label = () => props.fit(title(), props.scale.x0 - LAYOUT.labelX - 12)
  const span = () => {
    const { from, to } = props.draw
    if (from === undefined || to === undefined) {
      return undefined
    }
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
        {box => (
          <rect
            x={box().x}
            y={y() - 7}
            width={box().width}
            height="14"
            rx="3"
            fill="var(--kind-subagent)"
            fill-opacity="0.22"
          />
        )}
      </Show>
      <For each={bars()}>
        {bar => (
          <rect
            x={bar.x}
            y={y() - 4}
            width={Math.min(7, 3 + bar.count)}
            height="8"
            rx="2"
            fill="var(--kind-subagent)"
          />
        )}
      </For>
      <Show when={props.draw.spawn}>
        {spawn => (
          <path
            d={`M${xOf(props.scale, spawn().ts)} 82 V${y() - 7}`}
            stroke="var(--kind-subagent)"
            stroke-width="1"
            stroke-dasharray="2 3"
          />
        )}
      </Show>
      <FailedMarks marks={props.draw.failed} scale={props.scale} y={y() - 13} size={7} />
    </g>
  )
}
