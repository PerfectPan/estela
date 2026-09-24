import type { TimelineData } from './timeline-data.ts'
import type { TimeRange } from '@/lib/timeline-scale.ts'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatDuration } from '@/lib/format.ts'
import { edgeTo, isFullRange, makeScale, normalizeRange, stepEdge, tsOf, xOf } from '@/lib/timeline-scale.ts'
import { Axis, axisTop, compactionLabel, compactionLabelWidth, CompactionRule, LAYOUT, MainLane, SubLane } from './timeline-marks.tsx'
import { TimelineHeader } from './timeline-header.tsx'

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

  const scale = createMemo(() => makeScale(props.data.start, props.data.end, LAYOUT.x0, width() - LAYOUT.right))
  const subs = createMemo(() => props.data.subs.slice(0, LAYOUT.maxSubLanes))
  const extra = () => props.data.subs.length - subs().length
  const bottom = createMemo(() => axisTop(subs().length, extra() > 0))
  const height = () => bottom() + 22
  const range = () => isFullRange(props.range, scale()) ? undefined : props.range
  const edges = () => range() ?? { from: scale().start, to: scale().end }
  /** Compaction rules left to right; a rule is boxed when its label does not overlap the previous box. */
  const compactions = createMemo(() => {
    const marks = [props.data.main, ...props.data.subs].flatMap(draw => draw.compactions).toSorted((a, b) => a.ts - b.ts)
    let right = Number.NEGATIVE_INFINITY
    return marks.map((mark) => {
      const x = xOf(scale(), mark.ts)
      const boxed = x + 2 > right
      if (boxed)
        right = x + 6 + compactionLabelWidth(compactionLabel(mark))
      return { mark, boxed }
    })
  })

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
    const target = event.currentTarget as SVGRectElement
    target.setPointerCapture(event.pointerId)
    const startX = localX(event)
    const anchor = tsOf(scale(), startX)
    let moved = false
    const move = (next: PointerEvent) => {
      if (!moved && Math.abs(localX(next) - startX) < CLICK_PX)
        return
      moved = true
      commit(normalizeRange(anchor, tsOf(scale(), localX(next)), scale().start, scale().end))
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      if (moved)
        return
      const id = nearestRequest(startX)
      if (id)
        props.onSelect(id)
      else
        props.onRange(undefined)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  function onHandleDown(edge: Edge, event: PointerEvent): void {
    if (event.button !== 0)
      return
    event.stopPropagation()
    const target = event.currentTarget as SVGRectElement
    target.setPointerCapture(event.pointerId)
    target.focus()
    const move = (next: PointerEvent) => {
      const at = tsOf(scale(), localX(next))
      const current = edges()
      commit(edge === 'from'
        ? { from: Math.min(at, current.to), to: current.to }
        : { from: current.from, to: Math.max(at, current.from) })
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
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
            {(draw, index) => <SubLane draw={draw} index={index()} scale={scale()} />}
          </For>
          <Show when={extra() > 0}>
            <text x={LAYOUT.labelX} y={LAYOUT.firstLane + LAYOUT.laneStep * subs().length + 4} class="font-sans" font-size="12" fill="var(--subtle-foreground)">
              {t('timeline.moreLanes', { count: extra() })}
            </text>
          </Show>
          <For each={compactions()}>
            {item => <CompactionRule mark={item.mark} boxed={item.boxed} scale={scale()} bottom={bottom() - 2} />}
          </For>
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
    <g class="brush-handle">
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
