import { For } from 'solid-js'

const WIDTH = 296
const HEIGHT = 46
const BASELINE = 30
const TALLEST = 24
const BAR = 2

/**
 * Context over time: one bar per request, height = input tokens (the kernel's `contextShape`,
 * at most 120 points, sent scaled to 0–100). SVG only, no chart library (D9).
 */
export function ContextShape(props: { values: readonly number[], label: string }) {
  const max = () => Math.max(1, ...props.values)
  const slot = () => WIDTH / Math.max(1, props.values.length)
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} class="block max-w-full" role="img" aria-label={props.label}>
      <For each={props.values}>
        {(value, index) => {
          const height = () => Math.max(1, (value / max()) * TALLEST)
          return (
            <rect
              x={index() * slot() + Math.max(0, (slot() - BAR) / 2)}
              y={BASELINE - height()}
              width={Math.min(BAR, slot())}
              height={height()}
              rx="0.8"
              fill="var(--kind-request)"
            />
          )
        }}
      </For>
      <line x1="0" y1={BASELINE} x2={WIDTH} y2={BASELINE} stroke="var(--input)" />
    </svg>
  )
}
