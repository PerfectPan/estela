import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { SessionShape } from '@/scene/session-shape.ts'

/** One lane for the main agent and one per subagent, the spawn linked to its lane. */
export function LanesFigure({ shape, t }: { shape: SessionShape; t: Dictionary }) {
  const x = (step: number) => 74 + step * 6.8
  const rows = [
    { label: t.answers.figure.main, base: 40, bars: shape.main, color: 'var(--kind-request)', scale: 34 },
    ...shape.lanes.map((lane, index) => ({
      label: `${t.answers.figure.subagent} ${index + 1}`,
      base: 84 + index * 42,
      bars: lane.bars,
      color: 'var(--kind-subagent)',
      scale: 80,
      spawn: lane.spawnStep,
    })),
  ]
  return (
    <svg viewBox="0 0 320 140" className="h-auto w-full" aria-hidden="true" fontFamily="var(--font-mono)" fontSize="10">
      {rows.map(row => (
        <g key={row.label}>
          <text x="0" y={row.base - 2} fill="var(--muted-foreground)">
            {row.label}
          </text>
          <line x1="70" x2="320" y1={row.base + 0.5} y2={row.base + 0.5} stroke="var(--border)" />
          {'spawn' in row ? (
            <path
              d={`M${x(row.spawn)} 44 V${row.base - 12} H${x(row.bars[0]!.step) - 4}`}
              fill="none"
              stroke="var(--lane-link)"
              strokeDasharray="2 2.5"
            />
          ) : null}
          {row.bars.map(bar => {
            const h = Math.min((bar.tokens / shape.maxTokens) * row.scale, 32)
            return (
              <rect
                key={bar.step}
                x={x(bar.step) - 2.4}
                y={row.base - h}
                width="4.8"
                height={h}
                rx="0.8"
                fill={row.color}
              />
            )
          })}
        </g>
      ))}
    </svg>
  )
}
