import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { SessionShape } from './session-shape.ts'
import { compactTokens } from './session-shape.ts'

const WIDTH = 760
const HEIGHT = 470
const LEFT = 30
const RIGHT = 730
const BASE = 300
const MAIN_HEIGHT = 230
const LANE_TOP = 334
const LANE_ROW = 56
const LANE_HEIGHT = 40

/**
 * The hero session as the product's own timeline draws it, in SVG: the static view when WebGL is unavailable or
 * the reader prefers reduced motion, and what shows while the WebGL scene loads. It is prerendered, so the page
 * reads the same with no script at all.
 */
export function WakeFallback({ shape, t, className }: { shape: SessionShape; t: Dictionary; className?: string }) {
  const last = Math.max(...shape.main.map(bar => bar.step))
  const x = (step: number) => LEFT + (step / last) * (RIGHT - LEFT)
  const barWidth = ((RIGHT - LEFT) / last) * 0.62
  const mainHeight = (tokens: number) => (tokens / shape.maxTokens) * MAIN_HEIGHT
  const laneHeight = (tokens: number) => (tokens / shape.maxTokens) * LANE_HEIGHT * 3
  const selected = shape.main.find(bar => bar.step === shape.selected)!
  const ruleX = x(shape.compaction.step)
  const ruleTop = BASE - mainHeight(shape.compaction.before) - 18
  const scene = t.hero.scene
  const selectedHeight = mainHeight(selected.tokens)
  const selectedX = x(selected.step) - barWidth / 2

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      role="img"
      aria-label={scene.label}
      fontFamily="var(--font-mono)"
      fontSize="11"
    >
      <line x1={LEFT} x2={RIGHT} y1={BASE + 0.5} y2={BASE + 0.5} stroke="var(--input)" />
      {shape.main.map(bar => {
        if (bar.step === shape.selected) {
          return null
        }
        const h = mainHeight(bar.tokens)
        return (
          <rect
            key={bar.step}
            x={x(bar.step) - barWidth / 2}
            y={BASE - h}
            width={barWidth}
            height={h}
            rx="1.5"
            fill="var(--kind-request)"
            opacity={bar.shadowed ? 0.45 : 1}
          />
        )
      })}
      <g>
        <rect
          x={selectedX - 5}
          y={BASE - selectedHeight - 6}
          width={barWidth + 10}
          height={selectedHeight + 6}
          rx="3"
          fill="color-mix(in srgb, var(--kind-request) 12%, transparent)"
          stroke="color-mix(in srgb, var(--kind-request) 55%, transparent)"
        />
        <rect
          x={selectedX}
          y={BASE - selectedHeight}
          width={barWidth}
          height={selectedHeight * 0.72}
          fill="var(--kind-request)"
        />
        <rect
          x={selectedX}
          y={BASE - selectedHeight * 0.28}
          width={barWidth}
          height={selectedHeight * 0.16}
          fill="var(--kind-tool)"
        />
        <rect
          x={selectedX}
          y={BASE - selectedHeight * 0.12}
          width={barWidth}
          height={selectedHeight * 0.12}
          fill="var(--hatch-edge)"
        />
        <text x={selectedX + barWidth / 2} y={BASE - selectedHeight - 16} textAnchor="middle" fill="var(--foreground)">
          {scene.selected}
        </text>
      </g>
      <line
        x1={ruleX}
        x2={ruleX}
        y1={ruleTop}
        y2={BASE}
        stroke="var(--muted-foreground)"
        strokeDasharray="4 4"
        strokeWidth="1.2"
      />
      <text x={ruleX + 8} y={ruleTop + 10} fill="var(--muted-foreground)">
        {scene.compaction} · {compactTokens(shape.compaction.before)} → {compactTokens(shape.compaction.after)}
      </text>
      {shape.prompts.map(step => (
        <rect key={step} x={x(step) - 3.5} y={BASE + 8} width="7" height="7" rx="1" fill="var(--kind-user)" />
      ))}
      {shape.lanes.map((lane, index) => {
        const top = LANE_TOP + index * LANE_ROW
        const base = top + LANE_HEIGHT
        const first = lane.bars[0]!
        return (
          <g key={lane.spawnStep}>
            <path
              d={`M${x(lane.spawnStep)} ${BASE + 20} V${base - 4} H${x(first.step) - barWidth / 2 - 3}`}
              fill="none"
              stroke="var(--lane-link)"
              strokeDasharray="2 3"
            />
            <line
              x1={x(first.step) - barWidth}
              x2={x(lane.bars.at(-1)!.step) + barWidth}
              y1={base + 0.5}
              y2={base + 0.5}
              stroke="var(--border)"
            />
            {lane.bars.map(bar => {
              const h = Math.min(laneHeight(bar.tokens), LANE_HEIGHT)
              return (
                <rect
                  key={bar.step}
                  x={x(bar.step) - barWidth / 2}
                  y={base - h}
                  width={barWidth}
                  height={h}
                  rx="1.5"
                  fill="var(--kind-subagent)"
                />
              )
            })}
          </g>
        )
      })}
      <text x={RIGHT} y={HEIGHT - 6} textAnchor="end" fill="var(--subtle-foreground)">
        {scene.sample} · {scene.context}
      </text>
      <text x={x(shape.lanes[0]!.bars.at(-1)!.step) + 14} y={LANE_TOP + LANE_HEIGHT - 4} fill="var(--lane-link)">
        {scene.lane}
      </text>
    </svg>
  )
}
