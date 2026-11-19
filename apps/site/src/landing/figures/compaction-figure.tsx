import type { SessionShape } from '@/scene/session-shape.ts'
import { compactTokens } from '@/scene/session-shape.ts'

/** Bars up to a compaction and after it: the dashed rule with before → after, the hidden part dimmed. */
export function CompactionFigure({ shape }: { shape: SessionShape }) {
  const bars = shape.main.filter(bar => bar.step >= 12 && bar.step <= 31)
  const x = (step: number) => 8 + (step - 12) * 15.5
  const h = (tokens: number) => (tokens / shape.compaction.before) * 100
  const ruleX = x(shape.compaction.step)
  return (
    <svg
      viewBox="0 0 320 140"
      className="h-auto w-full"
      aria-hidden="true"
      fontFamily="var(--font-mono)"
      fontSize="10.5"
    >
      <line x1="0" x2="320" y1="130.5" y2="130.5" stroke="var(--input)" />
      {bars.map(bar => (
        <rect
          key={bar.step}
          x={x(bar.step) - 4.5}
          y={130 - h(bar.tokens)}
          width="9"
          height={h(bar.tokens)}
          rx="1"
          fill="var(--kind-request)"
          opacity={bar.shadowed ? 0.4 : 1}
        />
      ))}
      <line x1={ruleX} x2={ruleX} y1="14" y2="130" stroke="var(--muted-foreground)" strokeDasharray="3 3" />
      <rect x={ruleX + 6} y="6" width="78" height="18" rx="3" fill="var(--background)" stroke="var(--input)" />
      <text x={ruleX + 45} y="18.5" textAnchor="middle" fill="var(--foreground)">
        {compactTokens(shape.compaction.before)} → {compactTokens(shape.compaction.after)}
      </text>
    </svg>
  )
}
