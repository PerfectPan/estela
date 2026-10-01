import type { Mark } from './timeline-data.ts'
import type { TimeScale } from '@/lib/timeline-scale.ts'
import { For } from 'solid-js'
import { xOf } from '@/lib/timeline-scale.ts'

export function FailedMarks(props: { marks: Mark[]; scale: TimeScale; y: number; size?: number }) {
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
