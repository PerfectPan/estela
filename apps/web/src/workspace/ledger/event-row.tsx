import type { Entry } from '@/lib/ledger-model.ts'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { isShortened, numberField, rowText } from '@/lib/event-text.ts'
import { formatDuration, formatTokens } from '@/lib/format.ts'
import { ShortenedMark } from './shortened-mark.tsx'
import { ToolStatus } from './tool-status.tsx'
import type { RowContext } from './row-frame.tsx'
import { RowFrame, elapsed } from './row-frame.tsx'

const dash = () => t('common.dash')

export function EventRow(props: {
  entry: Extract<Entry, { type: 'event' }>
  depth: 0 | 1
  ctx: RowContext
  lane?: boolean
}) {
  const event = () => props.ctx.model.byId.get(props.entry.eventId)!
  const result = () => (props.entry.resultId ? props.ctx.model.byId.get(props.entry.resultId) : undefined)
  const text = () => rowText(event())
  const metric = () => {
    const current = event()
    const request = props.ctx.model.requests.get(current.id)?.entry
    if (request) {
      if (request.inputTokens === undefined && request.outputTokens === undefined) {
        return dash()
      }
      return t('ledger.inOut', {
        input: request.inputTokens === undefined ? dash() : formatTokens(request.inputTokens),
        output: request.outputTokens === undefined ? dash() : formatTokens(request.outputTokens),
      })
    }
    const duration = numberField(result(), 'durationMs') ?? numberField(current, 'durationMs')
    return duration === undefined ? '' : formatDuration(duration, locale())
  }
  const hidden = () =>
    props.ctx.dim
    && (props.ctx.model.hidden.has(props.entry.eventId)
      || (props.entry.resultId !== undefined && props.ctx.model.hidden.has(props.entry.resultId)))
  return (
    <RowFrame
      ordinal={props.entry.ordinal}
      kind={props.entry.kind}
      depth={props.depth}
      lane={props.lane}
      dimmed={hidden()}
      status={props.entry.kind === 'tool' ? <ToolStatus result={result()} /> : undefined}
      marker={isShortened(event()) || isShortened(result()) ? <ShortenedMark /> : undefined}
      metric={metric()}
      time={elapsed(event().ts, props.ctx)}
    >
      <Show when={text().text}>
        <span class={text().muted ? 'text-thinking-text' : undefined}>{text().text}</span>
      </Show>
      <Show when={text().mono}>
        <span class="ml-1.5 font-mono text-[12px]">{text().mono}</span>
      </Show>
    </RowFrame>
  )
}
