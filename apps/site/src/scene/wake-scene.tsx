import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { Locale } from '@/i18n/locale.ts'
import { useLanguage } from '@/hooks/use-language.ts'
import { cx } from '@/lib/cva.ts'
import type { Anchor } from './wake-instances.ts'
import { compactTokens, sessionShape } from './session-shape.ts'
import { WakeFallback } from './wake-fallback.tsx'
import { wakeLayout } from './wake-instances.ts'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/**
 * The hero scene. The prerendered SVG shows first; the WebGL scene (ogl, its own lazy chunk) replaces it only
 * when this language tree is visible, motion is allowed, and a context can be created, and is torn down if
 * the reader turns on reduced motion or switches language.
 */
export function WakeScene({ locale, t, className }: { locale: Locale; t: Dictionary; className?: string }) {
  const { lang } = useLanguage()
  const active = lang === locale
  const shape = useMemo(() => sessionShape(), [])
  const [live, setLive] = useState(false)
  const labels = useRef<Partial<Record<Anchor['id'], HTMLSpanElement | null>>>({})
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scene = t.hero.scene
  const annotations: { id: Anchor['id']; text: string; tone: string }[] = [
    { id: 'context', text: scene.context, tone: 'text-muted-foreground' },
    {
      id: 'compaction',
      text: `${scene.compaction} · ${compactTokens(shape.compaction.before)} → ${compactTokens(shape.compaction.after)}`,
      tone: 'text-foreground',
    },
    { id: 'lane', text: scene.lane, tone: 'text-lane-link' },
    { id: 'selected', text: scene.selected, tone: 'text-kind-request' },
  ]

  useEffect(() => {
    if (!active) {
      setLive(false)
      return
    }
    const motion = window.matchMedia(REDUCED_MOTION)
    let dispose: (() => void) | undefined
    let cancelled = false
    const stop = () => {
      cancelled = true
      dispose?.()
      dispose = undefined
      setLive(false)
    }
    const onMotionChange = () => {
      if (motion.matches) {
        stop()
      }
    }
    motion.addEventListener('change', onMotionChange)
    const sceneHost = hostRef.current
    const sceneCanvas = canvasRef.current
    if (!motion.matches && sceneHost && sceneCanvas) {
      void import('./wake-renderer.ts').then(({ createWakeRenderer }) => {
        if (cancelled) {
          return
        }
        const renderer = createWakeRenderer({
          canvas: sceneCanvas,
          host: sceneHost,
          layout: wakeLayout(shape),
          onAnchors: points => {
            for (const [id, point] of Object.entries(points)) {
              const label = labels.current[id as Anchor['id']]
              if (label) {
                label.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`
              }
            }
          },
          onReady: () => setLive(true),
          // The fallback comes back; the scene is not restarted.
          onLost: stop,
        })
        dispose = renderer?.dispose
      })
    }
    return () => {
      motion.removeEventListener('change', onMotionChange)
      stop()
    }
  }, [active, shape])

  return (
    <div ref={hostRef} className={cx('relative', className)} data-scene={live ? 'webgl' : 'static'}>
      <WakeFallback
        shape={shape}
        t={t}
        className={cx(
          'scene-fade absolute inset-x-[4%] top-[12%] bottom-[6%] h-auto w-[92%]',
          live ? 'opacity-0' : 'opacity-100',
        )}
      />
      <canvas
        key={active ? 'active' : 'idle'}
        ref={canvasRef}
        className={cx('scene-fade absolute inset-0 size-full', live ? 'opacity-100' : 'opacity-0')}
        aria-hidden="true"
      />
      <div className={cx('scene-fade pointer-events-none absolute inset-0', live ? 'opacity-100' : 'opacity-0')}>
        {annotations.map(annotation => (
          <span
            key={annotation.id}
            ref={element => {
              labels.current[annotation.id] = element
            }}
            className="absolute top-0 left-0 will-change-transform"
            aria-hidden="true"
          >
            <span
              className={cx(
                'block -translate-x-1/2 -translate-y-full rounded-md border border-border bg-background/80 px-2 py-1 font-mono text-[11px] whitespace-nowrap backdrop-blur-sm',
                annotation.tone,
              )}
            >
              {annotation.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
