import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { SessionShape } from '@/scene/session-shape.ts'

/** The workspace timeline: one bar per request (height = input tokens), prompt and failed-tool markers, a brush. */
export function TimelineFigure({ shape, t }: { shape: SessionShape; t: Dictionary }) {
  const x = (step: number) => 10 + step * 8.6
  const h = (tokens: number) => (tokens / shape.maxTokens) * 92
  const failedStep = 16
  const f = t.answers.figure
  return (
    <svg viewBox="0 0 320 140" className="h-auto w-full" aria-hidden="true" fontFamily="var(--font-mono)" fontSize="10">
      <rect
        x={x(24) - 5}
        y="4"
        width={x(30) - x(24) + 10}
        height="112"
        rx="3"
        fill="color-mix(in srgb, var(--kind-request) 10%, transparent)"
        stroke="color-mix(in srgb, var(--kind-request) 55%, transparent)"
      />
      <line x1="0" x2="320" y1="104.5" y2="104.5" stroke="var(--input)" />
      {shape.main.map(bar => (
        <rect
          key={bar.step}
          x={x(bar.step) - 3}
          y={104 - h(bar.tokens)}
          width="6"
          height={h(bar.tokens)}
          rx="1"
          fill="var(--kind-request)"
        />
      ))}
      <line
        x1={x(shape.compaction.step)}
        x2={x(shape.compaction.step)}
        y1="6"
        y2="104"
        stroke="var(--muted-foreground)"
        strokeDasharray="3 3"
      />
      {shape.prompts.map(step => (
        <rect key={step} x={x(step) - 3} y="111" width="6" height="6" rx="1" fill="var(--kind-user)" />
      ))}
      <g transform={`translate(${x(failedStep) - 6} 108)`} stroke="var(--destructive)" fill="none" strokeWidth="1.4">
        <path d="M6 1 L11.5 11 H0.5 Z" strokeLinejoin="round" />
        <path d="M6 5 V7.3 M6 9 V9.1" strokeLinecap="round" />
      </g>
      <g fill="var(--subtle-foreground)">
        <rect x="8" y="128" width="6" height="6" rx="1" fill="var(--kind-user)" />
        <text x="18" y="134">
          {f.prompt}
        </text>
        <g transform="translate(108 126)" stroke="var(--destructive)" fill="none" strokeWidth="1.2">
          <path d="M4.5 0.5 L8.8 8.5 H0.2 Z" strokeLinejoin="round" />
        </g>
        <text x="122" y="134">
          {f.failed}
        </text>
      </g>
    </svg>
  )
}
