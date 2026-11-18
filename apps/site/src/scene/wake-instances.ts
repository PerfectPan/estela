import type { SessionShape } from './session-shape.ts'

/**
 * Color roles of the scene. Each maps to a product token (scene-palette.ts), so a theme switch recolors the
 * scene without rebuilding it.
 */
export type Role = 'request' | 'shadowed' | 'subagent' | 'prompt' | 'rule' | 'hatch' | 'tool' | 'link' | 'halo'

/** One box: base center at `x, z`, bottom at `y`, grown from its base after `delay` seconds. */
export interface Instance {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
  role: Role
  delay: number
}

/** A point the page labels in HTML, tracked through the camera each frame. */
export interface Anchor {
  id: 'context' | 'compaction' | 'lane' | 'selected'
  position: [number, number, number]
}

export interface WakeLayout {
  solid: Instance[]
  /** Drawn after the solid boxes, blended and without depth writes. */
  glass: Instance[]
  anchors: Anchor[]
  /** Center of the drawn session on the floor, for the camera target. */
  center: [number, number, number]
  /** Seconds until the last bar has finished growing. */
  duration: number
}

export const STEP = 0.5
export const BAR = 0.3
export const MAX_HEIGHT = 7
/** Distance of the first subagent lane from the main lane, and between lanes, toward the camera. */
const LANE_GAP = 1.5
const GROW_START = 0.2
const GROW_PER_STEP = 0.05
export const GROW_SECONDS = 0.75

const delayAt = (step: number) => GROW_START + step * GROW_PER_STEP

/**
 * World layout of a session: time runs along x, the main lane sits on z = 0, and each subagent runs in its own
 * parallel lane toward the camera, linked to the request that spawned it, as in the product's timeline. The
 * selected request is split into the slots Model saw reports.
 */
export function wakeLayout(shape: SessionShape): WakeLayout {
  const height = (tokens: number) => (tokens / shape.maxTokens) * MAX_HEIGHT
  const solid: Instance[] = []
  const glass: Instance[] = []
  const bar = (x: number, z: number, h: number, role: Role, delay: number, y = 0): Instance => ({
    x,
    y,
    z,
    width: BAR,
    height: h,
    depth: BAR,
    role,
    delay,
  })

  for (const request of shape.main) {
    const x = request.step * STEP
    const h = height(request.tokens)
    if (request.step === shape.selected) {
      // The selected request's context by slot: a system prompt the log did not record, the tools, the messages.
      const slots: [Role, number][] = [
        ['hatch', 0.12],
        ['tool', 0.16],
        ['request', 0.72],
      ]
      let y = 0
      for (const [role, share] of slots) {
        solid.push({ ...bar(x, 0, h * share, role, delayAt(request.step), y), width: 0.42, depth: 0.42 })
        y += h * share
      }
      glass.push({ ...bar(x, 0, h + 0.5, 'halo', delayAt(request.step)), width: 0.9, depth: 0.9, y: -0.02 })
      continue
    }
    solid.push(bar(x, 0, h, request.shadowed ? 'shadowed' : 'request', delayAt(request.step)))
  }

  shape.lanes.forEach((lane, index) => {
    const spawnX = lane.spawnStep * STEP
    const laneZ = LANE_GAP * (index + 1)
    // The spawn link: a dotted path on the floor from the spawning request to the lane.
    const first = lane.bars[0]!
    const dots = 7
    for (let i = 1; i < dots; i++) {
      const t = i / dots
      const x = spawnX + (first.step * STEP - spawnX) * t
      const z = laneZ * t
      solid.push({ x, y: 0, z, width: 0.07, height: 0.07, depth: 0.07, role: 'link', delay: delayAt(lane.spawnStep) })
    }
    for (const request of lane.bars) {
      solid.push(bar(request.step * STEP, laneZ, height(request.tokens), 'subagent', delayAt(request.step)))
    }
  })

  // The compaction: a neutral dashed rule standing across the main lane, as tall as the context before it.
  const ruleX = shape.compaction.step * STEP
  const ruleHeight = height(shape.compaction.before) + 0.6
  const dash = 0.2
  for (let y = 0; y < ruleHeight; y += dash * 2) {
    solid.push({
      x: ruleX,
      y,
      z: 0,
      width: 0.035,
      height: dash,
      depth: 0.035,
      role: 'rule',
      delay: delayAt(ruleX / STEP),
    })
  }
  // The level the compaction cut the context to: a thin bar across the rule.
  solid.push({
    x: ruleX,
    y: height(shape.compaction.after),
    z: 0,
    width: 0.5,
    height: 0.035,
    depth: 0.6,
    role: 'rule',
    delay: delayAt(ruleX / STEP),
  })

  for (const step of shape.prompts) {
    solid.push({
      x: step * STEP,
      y: 0,
      z: 0.5,
      width: 0.16,
      height: 0.16,
      depth: 0.16,
      role: 'prompt',
      delay: delayAt(step),
    })
  }

  const lastStep = Math.max(...shape.main.map(request => request.step))
  const selected = shape.main.find(request => request.step === shape.selected)!
  const firstLane = shape.lanes[0]!
  const laneMid = firstLane.bars[Math.floor(firstLane.bars.length / 2)]!
  // The context label sits on an early request, away from the compaction's label.
  const early = shape.main[Math.floor(shape.compaction.step / 2)]!
  return {
    solid,
    glass,
    anchors: [
      { id: 'context', position: [early.step * STEP, height(early.tokens) + 0.2, 0] },
      { id: 'compaction', position: [ruleX, ruleHeight + 0.15, 0] },
      {
        id: 'lane',
        position: [laneMid.step * STEP, height(laneMid.tokens) + 0.2, LANE_GAP],
      },
      { id: 'selected', position: [selected.step * STEP, height(selected.tokens) + 0.55, 0] },
    ],
    center: [(lastStep * STEP) / 2, 0, 0],
    duration: delayAt(lastStep) + GROW_SECONDS,
  }
}
