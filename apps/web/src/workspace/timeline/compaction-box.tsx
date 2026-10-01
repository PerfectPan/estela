import type { LabelBox } from '@/lib/label-layout.ts'
import { Show } from 'solid-js'
import { PAD, moreText } from './compaction-label.ts'

export function CompactionBox(props: { box: LabelBox; label: string; more?: number; raised?: boolean }) {
  return (
    <g pointer-events="none" data-testid="compaction-box">
      <rect
        x={props.box.x}
        y="4"
        width={props.box.width}
        height="18"
        rx="4"
        fill="var(--muted)"
        stroke={props.raised ? 'var(--foreground)' : 'var(--input)'}
      />
      <text
        x={props.box.x + PAD}
        y="17"
        class="font-mono"
        font-size="10.5"
        fill="var(--foreground)"
        style={{ 'white-space': 'pre' }}
      >
        {props.label}
        <Show when={(props.more ?? 0) > 0}>
          <tspan fill="var(--subtle-foreground)">{moreText(props.more!)}</tspan>
        </Show>
      </text>
    </g>
  )
}
