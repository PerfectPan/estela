import type { TimeScale } from '@/lib/timeline-scale.ts'
import { For, createMemo } from 'solid-js'
import { locale } from '@/i18n/locale.ts'
import { formatDuration } from '@/lib/format.ts'
import { axisTicks, xOf } from '@/lib/timeline-scale.ts'

/** `0m` / `0分` on a minute axis, `0s` / `0秒` on a seconds axis. */
function zeroLabel(step: number): string {
  return formatDuration(step >= 60_000 ? 60_000 : 1000, locale()).replace(/\d+/, '0')
}

export function TimelineAxis(props: { scale: TimeScale; top: number }) {
  const ticks = createMemo(() =>
    axisTicks(props.scale, Math.max(2, Math.floor((props.scale.x1 - props.scale.x0) / 96))),
  )
  return (
    <For each={ticks()}>
      {at => {
        const x = () => xOf(props.scale, props.scale.start + at)
        return (
          <>
            <line x1={x()} y1={props.top} x2={x()} y2={props.top + 4} stroke="var(--input)" />
            <text
              x={x()}
              y={props.top + 16}
              text-anchor="middle"
              class="font-mono"
              font-size="10"
              fill="var(--subtle-foreground)"
            >
              {at === 0 ? zeroLabel(ticks()[1] ?? 1000) : formatDuration(at, locale())}
            </text>
          </>
        )
      }}
    </For>
  )
}
