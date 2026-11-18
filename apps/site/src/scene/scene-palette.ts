import type { Role } from './wake-instances.ts'

export type Rgb = [number, number, number]

export interface ScenePalette {
  roles: Record<Role, Rgb>
  background: Rgb
  grid: Rgb
}

/** `#rrggbb` → 0..1 channels. The tokens in styles.css are all six-digit hex; anything else falls back to gray. */
export function hexToRgb(value: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim())
  if (!match) {
    return [0.5, 0.5, 0.5]
  }
  return [parseInt(match[1]!, 16) / 255, parseInt(match[2]!, 16) / 255, parseInt(match[3]!, 16) / 255]
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

/** Reads the current theme's tokens, so the scene uses the product's own colors in both themes. */
export function readPalette(read: (token: string) => string): ScenePalette {
  const token = (name: string) => hexToRgb(read(name))
  const background = token('--background')
  const request = token('--kind-request')
  return {
    background,
    grid: token('--input'),
    roles: {
      request,
      // Requests whose events the compaction hid from the model, dimmed as the ledger dims them.
      shadowed: mix(request, background, 0.42),
      subagent: token('--kind-subagent'),
      prompt: token('--kind-user'),
      tool: token('--kind-tool'),
      rule: token('--muted-foreground'),
      hatch: token('--hatch-edge'),
      link: token('--lane-link'),
      halo: request,
    },
  }
}
