import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { formatBytes } from '@/lib/format.ts'
import { escapeBidi } from '@/lib/preview.ts'
import { estimateBytes, textChunks } from '@/lib/text-chunks.ts'

const PRE = 'm-0 font-mono text-[11.5px] leading-[1.6] break-words whitespace-pre-wrap [unicode-bidi:isolate]'

/**
 * Inspector text: session content as recorded, with bidi controls shown as escapes. Past
 * `TEXT_CAP` characters it stops with a "Show all (N MB)" control; the rest is appended
 * one block per frame, and blocks off screen skip layout (`content-visibility: auto`).
 */
export function TextView(props: { text: string; muted?: boolean }) {
  const chunks = createMemo(() => textChunks(props.text))
  const [shown, setShown] = createSignal(0)
  const [expanding, setExpanding] = createSignal(false)
  let frame = 0
  createEffect(
    on(
      () => props.text,
      () => {
        cancelAnimationFrame(frame)
        setShown(0)
        setExpanding(false)
      },
    ),
  )
  onCleanup(() => cancelAnimationFrame(frame))

  function expand(): void {
    setExpanding(true)
    const step = () => {
      setShown(count => count + 1)
      if (shown() < chunks().rest.length) {
        frame = requestAnimationFrame(step)
      } else {
        setExpanding(false)
      }
    }
    frame = requestAnimationFrame(step)
  }

  const size = createMemo(() =>
    chunks().rest.length > 0 ? `≈${formatBytes(estimateBytes(props.text), locale())}` : '',
  )
  return (
    <div class="flex flex-col" data-testid="inspector-body" dir="auto">
      <pre class={cx(PRE, props.muted ? 'text-subtle' : 'text-foreground')}>{escapeBidi(chunks().head)}</pre>
      <For each={chunks().rest.slice(0, shown())}>
        {block => (
          <pre class={cx(PRE, 'text-foreground [contain-intrinsic-size:auto_2000px] [content-visibility:auto]')}>
            {escapeBidi(block)}
          </pre>
        )}
      </For>
      <Show when={chunks().rest.length > 0 && shown() === 0 && !expanding()}>
        <button
          type="button"
          class="mt-3 self-start rounded-md border border-input px-2.5 py-1 text-[12px] text-link hover:bg-accent"
          data-testid="show-all-text"
          onClick={expand}
        >
          {t('inspector.showAllText', { size: size() })}
        </button>
      </Show>
    </div>
  )
}
