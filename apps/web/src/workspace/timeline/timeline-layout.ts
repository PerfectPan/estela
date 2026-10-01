/** Pixel layout from docs/design/session-workspace-*.html (1440 px wide, 166 px tall with two subagent lanes). */
export const LAYOUT = {
  labelX: 20,
  /** Plot start; the label column grows past it for long lane titles, up to `maxX0`. */
  x0: 148,
  maxX0: 280,
  right: 36,
  baseline: 74,
  barMax: 52,
  toolY: 77,
  promptY: 90,
  failedY: 83,
  firstLane: 104,
  laneStep: 26,
  maxSubLanes: 6,
  handleY: 90,
} as const

/** Bottom of the lane area: the axis starts 14 px below the last lane. */
export function axisTop(lanes: number, extra: boolean): number {
  const rows = lanes + (extra ? 1 : 0)
  return rows === 0 ? LAYOUT.firstLane - 4 : LAYOUT.firstLane + LAYOUT.laneStep * (rows - 1) + 14
}
