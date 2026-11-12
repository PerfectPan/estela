import type { CDPSession, Locator, Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * What the demo recording draws on top of the real UI and how it captures frames: a visible
 * pointer that follows Playwright's mouse (headless Chromium draws none), a click ring, a caption
 * pill, and a CDP screencast whose frames keep their own timestamps so ffmpeg can lay them out at
 * a constant frame rate. Nothing here changes the app; the overlay ignores pointer events.
 */

/** Runs in the page before any app script: the pointer, the click ring, and `window.demoCaption`. */
function overlay(): void {
  const install = () => {
    const style = document.createElement('style')
    style.textContent = `
      #demo-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
        width: 26px; height: 26px; transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.45)); }
      .demo-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px;
        margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgb(120 170 255 / 0.9);
        animation: demo-ring 520ms ease-out forwards; }
      @keyframes demo-ring { from { transform: scale(0.35); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
      #demo-caption { position: fixed; left: 50%; bottom: 34px; z-index: 2147483645; pointer-events: none;
        transform: translate(-50%, 8px); opacity: 0; transition: opacity 260ms ease, transform 260ms ease;
        padding: 10px 20px; border-radius: 12px; background: rgb(12 14 18 / 0.86); color: #f3f5f8;
        border: 1px solid rgb(255 255 255 / 0.12); backdrop-filter: blur(8px);
        font: 500 19px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: -0.005em;
        box-shadow: 0 10px 30px rgb(0 0 0 / 0.35); white-space: nowrap; }
      #demo-caption.shown { opacity: 1; transform: translate(-50%, 0); }`
    document.head.append(style)
    const pointer = document.createElement('div')
    pointer.id = 'demo-pointer'
    pointer.innerHTML =
      '<svg viewBox="0 0 26 26" width="26" height="26"><path d="M5 3 L5 21 L9.6 16.7 L12.6 23.4 L15.6 22.1 L12.7 15.5 L19 15.3 Z" fill="#ffffff" stroke="#111318" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    document.body.append(pointer, caption)
    window.addEventListener(
      'mousemove',
      event => {
        pointer.style.transform = `translate(${event.clientX - 5}px, ${event.clientY - 3}px)`
      },
      true,
    )
    window.addEventListener(
      'mousedown',
      event => {
        const ring = document.createElement('div')
        ring.className = 'demo-ring'
        ring.style.left = `${event.clientX}px`
        ring.style.top = `${event.clientY}px`
        document.body.append(ring)
        setTimeout(() => ring.remove(), 600)
      },
      true,
    )
    Object.assign(window, {
      demoCaption(text: string | null) {
        if (text) {
          caption.textContent = text
          caption.classList.add('shown')
        } else {
          caption.classList.remove('shown')
        }
      },
    })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install)
  } else {
    install()
  }
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export class Stage {
  private x = 0
  private y = 0
  private readonly page: Page
  private readonly captions: boolean

  constructor(page: Page, options: { captions: boolean; start: { x: number; y: number } }) {
    this.page = page
    this.captions = options.captions
    this.x = options.start.x
    this.y = options.start.y
  }

  static async install(page: Page): Promise<void> {
    await page.addInitScript(overlay)
  }

  /** Shows the pointer where the stage thinks it is (after a navigation the overlay is new). */
  async place(): Promise<void> {
    await this.page.mouse.move(this.x, this.y)
  }

  /** Moves the pointer along an eased path, about one step per frame. */
  async moveTo(x: number, y: number, ms = 700): Promise<void> {
    const from = { x: this.x, y: this.y }
    const steps = Math.max(2, Math.round(ms / 16))
    const start = Date.now()
    for (let step = 1; step <= steps; step++) {
      const t = easeInOut(step / steps)
      await this.page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t)
      const due = start + (ms * step) / steps
      const wait = due - Date.now()
      if (wait > 0) {
        await sleep(wait)
      }
    }
    this.x = x
    this.y = y
  }

  /** Moves to a point inside `target` (fractions of its box, the center by default). */
  async moveToLocator(target: Locator, ms = 700, at = { x: 0.5, y: 0.5 }): Promise<void> {
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) {
      throw new Error(`no box for ${target.toString()}`)
    }
    await this.moveTo(box.x + box.width * at.x, box.y + box.height * at.y, ms)
  }

  async click(target?: Locator, ms = 700, at?: { x: number; y: number }): Promise<void> {
    if (target) {
      await this.moveToLocator(target, ms, at)
    }
    await sleep(120)
    await this.page.mouse.down()
    await sleep(70)
    await this.page.mouse.up()
  }

  async type(text: string, delay = 75): Promise<void> {
    await this.page.keyboard.type(text, { delay })
  }

  async wheel(dy: number, ms = 600): Promise<void> {
    const steps = Math.max(1, Math.round(ms / 16))
    for (let step = 0; step < steps; step++) {
      await this.page.mouse.wheel(0, dy / steps)
      await sleep(16)
    }
  }

  async caption(text: string | null): Promise<void> {
    if (this.captions) {
      await this.page.evaluate(value => {
        // The overlay script above defines this function on window; the cast names its known shape.
        ;(window as unknown as { demoCaption: (text: string | null) => void }).demoCaption(value)
      }, text)
    }
  }

  async hold(ms: number): Promise<void> {
    await sleep(ms)
  }
}

export interface Frame {
  file: string
  /** Seconds, from the screencast metadata. */
  at: number
}

/** A CDP screencast to numbered JPEG files. `stop()` returns the frames in order. */
export async function startCapture(
  page: Page,
  dir: string,
  size: { width: number; height: number },
): Promise<{ stop: () => Promise<Frame[]> }> {
  await mkdir(dir, { recursive: true })
  const cdp: CDPSession = await page.context().newCDPSession(page)
  const frames: Frame[] = []
  const writes: Promise<void>[] = []
  cdp.on('Page.screencastFrame', frame => {
    const file = join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`)
    frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 })
    writes.push(writeFile(file, Buffer.from(frame.data, 'base64')))
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  })
  return {
    stop: async () => {
      await cdp.send('Page.stopScreencast')
      await Promise.all(writes)
      // The last frame lasts until the stop.
      frames.push({ file: frames.at(-1)!.file, at: Date.now() / 1000 })
      await cdp.detach()
      return frames
    },
  }
}
