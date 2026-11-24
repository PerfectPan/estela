import { createSignal } from 'solid-js'

let context: CanvasRenderingContext2D | null | undefined
const [fontsReady, setFontsReady] = createSignal(0)
if (typeof document !== 'undefined' && 'fonts' in document) {
  void document.fonts.ready.then(() => setFontsReady(count => count + 1))
}

/**
 * Width in px of `text` in `font` (a CSS font shorthand), measured with a canvas. Reading it
 * inside a memo re-runs the memo once the bundled fonts have loaded. Without a canvas (tests)
 * it falls back to `fallbackPx` per character.
 */
export function measureText(text: string, font: string, fallbackPx = 6.6): number {
  fontsReady()
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!context) {
    return Array.from(text).length * fallbackPx
  }
  context.font = font
  return context.measureText(text).width
}

/** `text` cut with an ellipsis so that it measures at most `width`. */
export function fitMeasured(text: string, width: number, measure: (text: string) => number): string {
  if (measure(text) <= width) {
    return text
  }
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(`${chars.slice(0, mid).join('')}…`) <= width) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return `${chars.slice(0, Math.max(1, lo)).join('')}…`
}
