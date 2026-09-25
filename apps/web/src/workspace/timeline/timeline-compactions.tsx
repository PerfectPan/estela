import type { CompactionMark } from './timeline-data.ts'
import type { TimeScale } from '@/lib/timeline-scale.ts'
import type { LabelBox } from '@/lib/label-layout.ts'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'
import { formatTokens } from '@/lib/format.ts'
import { layoutLabels, placeLabel } from '@/lib/label-layout.ts'
import { measureText } from '@/lib/measure-text.ts'
import { xOf } from '@/lib/timeline-scale.ts'

const LABEL_FONT = '10.5px "JetBrains Mono", "SF Mono", Menlo, Consolas, "PingFang SC", monospace'
/** Text inset inside the box, left and right. */
const PAD = 8

function labelOf(mark: CompactionMark): string {
  const { preTokens, postTokens } = mark
  const numbers = preTokens !== undefined && postTokens !== undefined ? `  ${formatTokens(preTokens)} → ${formatTokens(postTokens)}` : ''
  return `${t('timeline.compacted')}${numbers}`
}

function moreText(more: number): string {
  return more > 0 ? `  ${t('timeline.moreCompactions', { count: more })}` : ''
}

function Box(props: { box: LabelBox, label: string, more?: number, raised?: boolean }) {
  return (
    <g pointer-events="none" data-testid="compaction-box">
      <rect x={props.box.x} y="4" width={props.box.width} height="18" rx="4" fill="var(--muted)" stroke={props.raised ? 'var(--foreground)' : 'var(--input)'} />
      <text x={props.box.x + PAD} y="17" class="font-mono" font-size="10.5" fill="var(--foreground)" style={{ 'white-space': 'pre' }}>
        {props.label}
        <Show when={(props.more ?? 0) > 0}>
          <tspan fill="var(--subtle-foreground)">{moreText(props.more!)}</tspan>
        </Show>
      </text>
    </g>
  )
}

/**
 * Compaction rules (S5): a neutral dashed rule per compaction, and a `compacted pre → post`
 * box laid out left to right (`layoutLabels`) so boxes never overlap, flipping left at the
 * right edge. A rule whose box does not fit is counted as `+N` inside the box before it, and
 * every rule has a hover and keyboard-focus target that shows its own box on top.
 * Rendered after the plot's drag surface, so the boxes and targets receive the pointer.
 */
export function CompactionLayer(props: { marks: CompactionMark[], scale: TimeScale, bottom: number, right: number }) {
  const items = createMemo(() => props.marks.map((mark) => {
    const label = labelOf(mark)
    return { mark, label, x: xOf(props.scale, mark.ts), width: measureText(label, LABEL_FONT, 6.3) + PAD * 2 }
  }))
  // A box that folds in its neighbours grows by its "+N"; lay out again until the counts settle.
  const slots = createMemo(() => {
    const base = items()
    let layout = layoutLabels(base, props.right)
    for (let pass = 0; pass < 3; pass++) {
      const widths = base.map((item, index) => item.width + (layout[index]!.more > 0 ? measureText(moreText(layout[index]!.more), LABEL_FONT, 6.3) : 0))
      const next = layoutLabels(base.map((item, index) => ({ x: item.x, width: widths[index]! })), props.right)
      const settled = next.every((slot, index) => slot.more === layout[index]!.more && Boolean(slot.box) === Boolean(layout[index]!.box))
      layout = next
      if (settled)
        break
    }
    return layout
  })
  const [active, setActive] = createSignal<number>()
  const activeBox = () => {
    const index = active()
    if (index === undefined)
      return undefined
    const item = items()[index]
    return item ? { item, box: slots()[index]?.box ?? placeLabel(item.x, item.width, props.right) } : undefined
  }
  return (
    <g>
      <For each={items()}>
        {item => <line x1={item.x} y1="8" x2={item.x} y2={props.bottom} stroke="var(--foreground)" stroke-width="1.2" stroke-dasharray="4 3" pointer-events="none" />}
      </For>
      <For each={items()}>
        {(item, index) => (
          <Show when={slots()[index()]?.box}>
            {box => <Box box={box()} label={item.label} more={slots()[index()]!.more} />}
          </Show>
        )}
      </For>
      <For each={items()}>
        {(item, index) => (
          <rect
            x={item.x - 4}
            y="4"
            width="8"
            height={props.bottom - 4}
            fill="transparent"
            class="cursor-default outline-none"
            tabindex="0"
            role="img"
            aria-label={item.label}
            data-marker="compaction"
            data-label={item.label}
            data-boxed={slots()[index()]?.box ? 'true' : 'false'}
            onPointerEnter={() => setActive(index())}
            onPointerLeave={() => setActive(undefined)}
            onFocus={() => setActive(index())}
            onBlur={() => setActive(undefined)}
          >
            <title>{item.label}</title>
          </rect>
        )}
      </For>
      <Show when={activeBox()}>
        {current => <Box box={current().box} label={current().item.label} raised />}
      </Show>
    </g>
  )
}
