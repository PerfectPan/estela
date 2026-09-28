import type { ReconstructResult, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { LedgerRow } from '@/lib/ledger'
import type { MessageKey } from '@/i18n/locale.ts'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { reconstruct } from '@rivus/agent-trace-kernel/reconstruct'
import { KindTag } from '@/components/kind-tag'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'

type Tab = 'input' | 'output' | 'raw' | 'model'

const TABS: { id: Tab, label: MessageKey }[] = [
  { id: 'input', label: 'inspector.input' },
  { id: 'output', label: 'inspector.output' },
  { id: 'model', label: 'inspector.model' },
  { id: 'raw', label: 'inspector.raw' },
]

function eventsFor(trace: Trace, row: LedgerRow): TraceEvent[] {
  return row.eventIds
    .map(id => trace.events.find(event => event.id === id))
    .filter((event): event is TraceEvent => event != null)
}

function pretty(value: unknown): string {
  if (value == null)
    return ''
  if (typeof value === 'string')
    return value
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

export function Inspector(props: {
  trace: Trace
  row: LedgerRow | undefined
  onClose: () => void
}) {
  const [tab, setTab] = createSignal<Tab>('input')
  const selectedEvents = createMemo(() => props.row ? eventsFor(props.trace, props.row) : [])
  const modelView = createMemo((): ReconstructResult | undefined => {
    const row = props.row
    if (!row)
      return undefined
    return reconstruct(props.trace, row.eventIds[row.eventIds.length - 1]!)
  })

  const inputText = createMemo(() => {
    const [call] = selectedEvents()
    if (!call)
      return ''
    return pretty(call.payload.args ?? call.payload.text ?? call.payload)
  })
  const outputText = createMemo(() => {
    const events = selectedEvents()
    const result = events.find(event => event.kind === 'tool_result') ?? events.at(-1)
    if (!result)
      return ''
    return pretty(result.payload.output ?? result.payload.text ?? '')
  })
  const rawText = createMemo(() => pretty(selectedEvents().map(event => event.original)))
  const body = createMemo(() => {
    switch (tab()) {
      case 'input': return inputText() || t('common.notAvailable')
      case 'output': return outputText() || t('common.notAvailable')
      case 'raw': return rawText() || t('common.notAvailable')
      case 'model': return pretty(modelView()) || t('common.notAvailable')
    }
  })

  return (
    <aside class="flex w-[clamp(320px,38%,440px)] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header class="flex h-[42px] items-center gap-2 border-b border-border px-3">
        <Show when={props.row} fallback={<span class="text-xs text-muted-foreground">{t('workspace.selectRecord')}</span>}>
          {row => (
            <>
              <KindTag kind={row().kind} />
              <span class="min-w-0 truncate font-mono text-xs">{row().name ?? row().preview}</span>
              <span class="flex-1" />
              <Button variant="ghost" size="icon" class="size-7" onClick={props.onClose} aria-label={t('inspector.close')}>
                ×
              </Button>
            </>
          )}
        </Show>
      </header>
      <Show when={props.row}>
        <div class="flex gap-1 border-b border-border px-2 py-1">
          <For each={TABS}>
            {item => (
              <button
                type="button"
                class={cx(
                  'h-6 rounded-sm px-2 text-[11px]',
                  tab() === item.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
                )}
                onClick={() => setTab(item.id)}
              >
                {t(item.label)}
              </button>
            )}
          </For>
        </div>
        <pre class="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap">{body()}</pre>
      </Show>
    </aside>
  )
}
