import type { TimelineData } from './timeline-data.ts'
import type { TimeRange } from '@/lib/timeline-scale.ts'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatDuration } from '@/lib/format.ts'
import { fitMeasured, measureText } from '@/lib/measure-text.ts'
import { edgeTo, inRange, isFullRange, makeScale, normalizeRange, stepEdge, tsOf, xOf } from '@/lib/timeline-scale.ts'
import { CompactionLayer } from './timeline-compactions.tsx'
import { Axis, axisTop, LAYOUT, MainLane, SubLane } from './timeline-marks.tsx'
import { TimelineHeader } from './timeline-header.tsx'

/** Lane labels are 12 px in the UI font. */
function labelFont(): string {
  return `12px ${typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.body).fontFamily}`
}

function measureLabel(text: string): number {
  return measureText(text, labelFont())
}

/** Pointer capture on `target` until the button is released or the pointer is lost. */
function trackDrag(target: Element, event: PointerEvent, onMove: (move: PointerEvent) => void, onEnd: () => void): void {
  target.setPointerCapture(event.pointerId)
  const end = () => {
    target.removeEventListener('pointermove', onMove as EventListener)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
    onEnd()
  }
  target.addEventListener('pointermove', onMove as EventListener)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
}

/** A drag shorter than this is a click: it selects the nearest request, or clears the range. */
const CLICK_PX = 3

type Edge = 'from' | 'to'

/**
 * SVG timeline (3.6): one lane for the main agent and one per subagent, drawn from kernel
 * projections. Dragging on the plot selects a range, which filters the ledger (S6); the two
 * handles are sliders that move with the arrow keys (Shift for 10 % steps, Home / End).
 */
export function Timeline(props: {
  data: TimelineData
  range?: TimeRange
  onRange: (range: TimeRange | undefined) => void
  count: number
  selectedId?: string
  onSelect: (eventId: string) => void
}) {
  let host: HTMLDivElement | undefined
  let svg: SVGSVGElement | undefined
  const [width, setWidth] = createSignal(1440)
  onMount(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(480, Math.round(entries[0]!.contentRect.width))))
    if (host)
      observer.observe(host)
    onCleanup(() => observer.disconnect())
  })

  const subs = createMemo(() => props.data.subs.slice(0, LAYOUT.maxSubLanes))
  /** The label column grows for long lane titles, up to `maxX0`; longer titles are cut with an ellipsis. */
  const plotStart = createMemo(() => {
    const widest = Math.max(measureLabel(t('timeline.mainAgent')), ...subs().map(draw => measureLabel(draw.lane.title ?? draw.lane.id)))
    return Math.min(LAYOUT.maxX0, Math.max(LAYOUT.x0, LAYOUT.labelX + widest + 16))
  })
  const scale = createMemo(() => makeScale(props.data.start, props.data.end, plotStart(), width() - LAYOUT.right))
  const extra = () => props.data.subs.length - subs().length
  const bottom = createMemo(() => axisTop(subs().length, extra() > 0))
  const height = () => bottom() + 22
  const range = () => isFullRange(props.range, scale()) ? undefined : props.range
  const edges = () => range() ?? { from: scale().start, to: scale().end }
  const compactions = createMemo(() => [props.data.main, ...props.data.subs].flatMap(draw => draw.compactions).toSorted((a, b) => a.ts - b.ts))

  function localX(event: PointerEvent): number {
    const box = svg!.getBoundingClientRect()
    return event.clientX - box.left
  }

  function commit(next: TimeRange): void {
    props.onRange(isFullRange(next, scale()) ? undefined : next)
  }

  function nearestRequest(x: number): string | undefined {
    let best: { id: string, gap: number } | undefined
    for (const bar of props.data.main.bars) {
      const gap = Math.abs(xOf(scale(), bar.ts) - x)
      if (gap <= 4 && (!best || gap < best.gap))
        best = { id: bar.id, gap }
    }
    return best?.id
  }

  function onPlotDown(event: PointerEvent): void {
    if (event.button !== 0)
      return
    const startX = localX(event)
    const anchor = tsOf(scale(), startX)
    let moved = false
    trackDrag(event.currentTarget as Element, event, (next) => {
      if (!moved && Math.abs(localX(next) - startX) < CLICK_PX)
        return
      moved = true
      commit(normalizeRange(anchor, tsOf(scale(), localX(next)), scale().start, scale().end))
    }, () => {
      if (moved)
        return
      const id = nearestRequest(startX)
      if (id)
        props.onSelect(id)
      // A click outside the selected range clears it; inside it keeps the range.
      else if (!inRange(anchor, range()))
        props.onRange(undefined)
    })
  }

  function onHandleDown(edge: Edge, event: PointerEvent): void {
    if (event.button !== 0)
      return
    event.stopPropagation()
    const target = event.currentTarget as SVGRectElement
    target.focus()
    trackDrag(target, event, (next) => {
      const at = tsOf(scale(), localX(next))
      const current = edges()
      commit(edge === 'from'
        ? { from: Math.min(at, current.to), to: current.to }
        : { from: current.from, to: Math.max(at, current.from) })
    }, () => {})
  }

  function onHandleKey(edge: Edge, event: KeyboardEvent): void {
    const current = edges()
    let next: TimeRange | undefined
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
      next = stepEdge(current, edge, -1, event.shiftKey, scale())
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
      next = stepEdge(current, edge, 1, event.shiftKey, scale())
    else if (event.key === 'Home')
      next = edgeTo(current, edge, 'start', scale())
    else if (event.key === 'End')
      next = edgeTo(current, edge, 'end', scale())
    else if (event.key === 'Escape')
      props.onRange(undefined)
    else
      return
    event.preventDefault()
    if (next)
      commit(next)
  }

  const elapsed = (ts: number) => ts - scale().start
  const header = () => {
    const current = range()
    return current ? { from: elapsed(current.from), to: elapsed(current.to) } : undefined
  }

  return (
    <section class="shrink-0 border-b border-border bg-background" aria-label={t('timeline.title')}>
      <TimelineHeader range={header()} duration={scale().end - scale().start} count={props.count} onClear={() => props.onRange(undefined)} />
      <div ref={(element) => { host = element }} class="w-full">
        <svg ref={(element) => { svg = element }} width={width()} height={height()} viewBox={`0 0 ${width()} ${height()}`} class="block select-none" role="group" aria-label={t('timeline.label')}>
          <Show when={range()}>
            {current => (
              <rect
                x={xOf(scale(), current().from)}
                y="10"
                width={Math.max(0, xOf(scale(), current().to) - xOf(scale(), current().from))}
                height={bottom() - 12}
                fill="var(--kind-request)"
                fill-opacity="0.07"
              />
            )}
          </Show>
          <MainLane draw={props.data.main} scale={scale()} top={props.data.top} selectedId={props.selectedId} />
          <For each={subs()}>
            {(draw, index) => <SubLane draw={draw} index={index()} scale={scale()} fit={(text, room) => fitMeasured(text, room, measureLabel)} />}
          </For>
          <Show when={extra() > 0}>
            <text x={LAYOUT.labelX} y={LAYOUT.firstLane + LAYOUT.laneStep * subs().length + 4} class="font-sans" font-size="12" fill="var(--subtle-foreground)">
              {t('timeline.moreLanes', { count: extra() })}
            </text>
          </Show>
          <Axis scale={scale()} top={bottom()} />
          <rect
            x={scale().x0}
            y="0"
            width={scale().x1 - scale().x0}
            height={bottom()}
            fill="transparent"
            class="cursor-crosshair"
            data-testid="timeline-plot"
            onPointerDown={onPlotDown}
          />
          <CompactionLayer marks={compactions()} scale={scale()} bottom={bottom() - 2} right={width() - 4} />
          <For each={['from', 'to'] as const}>
            {edge => (
              <Handle
                edge={edge}
                x={xOf(scale(), edges()[edge])}
                bottom={bottom() - 2}
                active={range() !== undefined}
                label={t(edge === 'from' ? 'timeline.rangeStart' : 'timeline.rangeEnd')}
                valueNow={elapsed(edges()[edge])}
                valueMax={scale().end - scale().start}
                onPointerDown={event => onHandleDown(edge, event)}
                onKeyDown={event => onHandleKey(edge, event)}
              />
            )}
          </For>
        </svg>
      </div>
    </section>
  )
}

function Handle(props: {
  edge: Edge
  x: number
  bottom: number
  active: boolean
  label: string
  valueNow: number
  valueMax: number
  onPointerDown: (event: PointerEvent) => void
  onKeyDown: (event: KeyboardEvent) => void
}) {
  return (
    <g class="brush-handle" data-idle={props.active ? 'false' : 'true'}>
      <Show when={props.active}>
        <line x1={props.x} y1="10" x2={props.x} y2={props.bottom} stroke="var(--kind-request)" stroke-width="1" stroke-opacity="0.7" />
      </Show>
      <rect
        x={props.x - 3}
        y={LAYOUT.handleY}
        width="6"
        height="18"
        rx="3"
        fill="var(--muted)"
        stroke="var(--kind-request)"
        stroke-width="1.2"
        class="cursor-ew-resize outline-none"
        tabindex="0"
        role="slider"
        aria-label={props.label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(props.valueMax)}
        aria-valuenow={Math.round(props.valueNow)}
        aria-valuetext={formatDuration(props.valueNow, locale())}
        data-testid={`brush-${props.edge}`}
        onPointerDown={event => props.onPointerDown(event)}
        onKeyDown={event => props.onKeyDown(event)}
      />
    </g>
  )
}
