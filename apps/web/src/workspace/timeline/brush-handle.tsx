import { Show } from 'solid-js'
import { locale } from '@/i18n/locale.ts'
import { formatDuration } from '@/lib/format.ts'
import { LAYOUT } from './timeline-layout.ts'

/** Which end of the brush a handle moves. */
export type Edge = 'from' | 'to'

export function BrushHandle(props: {
  edge: Edge
  x: number
  bottom: number
  active: boolean
  label: string
  valueNow: number
  valueMax: number
  onPointerDown: (event: PointerEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
}) {
  return (
    <g class="brush-handle" data-idle={props.active ? 'false' : 'true'}>
      <Show when={props.active}>
        <line
          x1={props.x}
          y1="10"
          x2={props.x}
          y2={props.bottom}
          stroke="var(--kind-request)"
          stroke-width="1"
          stroke-opacity="0.7"
        />
      </Show>
      <rect
        x={props.x - 3}
        y={LAYOUT.handleY}
        width="6"
        height="18"
        rx="3"
        fill="var(--muted)"
        stroke="var(--kind-request)"
        stroke-width="1.2"
        class="cursor-ew-resize outline-none"
        tabindex="0"
        role="slider"
        aria-label={props.label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(props.valueMax)}
        aria-valuenow={Math.round(props.valueNow)}
        aria-valuetext={formatDuration(props.valueNow, locale())}
        data-testid={`brush-${props.edge}`}
        onPointerDown={event => props.onPointerDown(event)}
        onKeyDown={event => props.onKeyDown(event)}
      />
    </g>
  )
}
