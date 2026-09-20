import type { ReconstructResult, Trace, TraceEvent } from '@agent-trace/schema'
import type { LedgerRow } from '@/lib/ledger'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { reconstruct } from '@agent-trace/kernel/reconstruct'
import { KindTag } from '@/components/kind-tag'
import { Button } from '@/components/ui/button'
import { cx } from '@/lib/cva'

type Tab = 'input' | 'output' | 'raw' | 'model'

const TABS: { id: Tab, label: string }[] = [
  { id: 'input', label: 'Input' },
  { id: 'output', label: 'Output' },
  { id: 'raw', label: 'Raw' },
  { id: 'model', label: 'Model' },
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
      case 'input': return inputText() || 'Not available'
      case 'output': return outputText() || 'Not available'
      case 'raw': return rawText() || 'Not available'
      case 'model': return pretty(modelView()) || 'Not available'
    }
  })

  return (
    <aside class="flex w-[clamp(320px,38%,440px)] min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <header class="flex h-[42px] items-center gap-2 border-b border-border px-3">
        <Show when={props.row} fallback={<span class="text-xs text-muted-foreground">Select a record</span>}>
          {row => (
            <>
              <KindTag kind={row().kind} />
              <span class="min-w-0 truncate font-mono text-xs">{row().name ?? row().preview}</span>
              <span class="flex-1" />
              <Button variant="ghost" size="icon" class="size-7" onClick={props.onClose} aria-label="Close inspector">
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
                {item.label}
              </button>
            )}
          </For>
        </div>
        <pre class="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap">{body()}</pre>
      </Show>
    </aside>
  )
}
