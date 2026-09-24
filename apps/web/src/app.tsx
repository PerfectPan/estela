import type { DevframeScopedClientContext } from 'devframe/client'
import type { TraceView } from '@rivus/agent-trace-rpc'
import type { LedgerRow } from '@/lib/ledger'
import { For, Show, createMemo, createResource, createSignal } from 'solid-js'
import { connectDevframe } from 'devframe/client'
import { Inspector } from '@/components/inspector'
import { KindTag } from '@/components/kind-tag'
import { cx } from '@/lib/cva'
import { buildLedger, formatClock } from '@/lib/ledger'

const NAMESPACE = 'agent-trace'
type Ctx = DevframeScopedClientContext<typeof NAMESPACE>

async function connect(): Promise<TraceView> {
  const client = await connectDevframe()
  const ctx = client.scope(NAMESPACE) as Ctx
  return ctx.rpc.call('get-trace') as Promise<TraceView>
}

export function App() {
  const [boot] = createResource(connect)
  const [selected, setSelected] = createSignal<string>()
  const [query, setQuery] = createSignal('')
  const sections = createMemo(() => boot() ? buildLedger(boot()!.trace) : [])
  const selectedRow = createMemo((): LedgerRow | undefined => {
    const id = selected()
    for (const section of sections()) {
      const row = section.rows.find(item => item.id === id)
      if (row)
        return row
    }
    return undefined
  })
  const visibleSections = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q)
      return sections()
    return sections()
      .map(section => ({
        ...section,
        rows: section.rows.filter(row =>
          row.preview.toLowerCase().includes(q)
          || row.kind.includes(q)
          || (row.name?.toLowerCase().includes(q) ?? false)),
      }))
      .filter(section => section.rows.length > 0)
  })

  return (
    <Show when={boot()} fallback={<div class="grid h-full place-items-center text-[12px] text-muted-foreground">Connecting…</div>}>
      {view => (
        <div class="flex h-full flex-col bg-background text-foreground">
          <div class="flex h-8 shrink-0 items-center gap-2 border-b border-border px-1.5" role="toolbar">
            <span class="px-1.5 text-[12px] font-medium">Trajectory</span>
            <span class="rounded-sm bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">{view().trace.host}</span>
            <span class="flex-1" />
            <input
              class="h-5 w-44 rounded-sm border border-border bg-background px-2 text-[12px] outline-none placeholder:text-muted-foreground"
              placeholder="Search"
              value={query()}
              onInput={event => setQuery(event.currentTarget.value)}
            />
          </div>
          <div class="flex min-h-0 flex-1 overflow-hidden">
            <section class="min-w-[280px] flex-1 overflow-auto">
              <table class="w-full table-fixed border-collapse text-[12px]">
                <thead class="sticky top-0 z-10 bg-muted">
                  <tr class="h-[30px] text-left text-muted-foreground">
                    <th class="w-[122px] px-2 font-medium">Event</th>
                    <th class="px-2 font-medium">Content</th>
                    <th class="w-[88px] px-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={visibleSections()}>
                    {section => (
                      <>
                        <tr class="h-5 text-[11px] text-muted-foreground">
                          <td class="px-2" colspan="3">{section.title}</td>
                        </tr>
                        <For each={section.rows}>
                          {row => (
                            <tr
                              class={cx(
                                'h-[30px] cursor-default border-b border-border/60',
                                selected() === row.id ? 'bg-accent' : 'hover:bg-accent/50',
                                row.shadowed && 'opacity-50',
                              )}
                              data-kind={row.kind}
                              onClick={() => setSelected(row.id)}
                            >
                              <td class="px-2">
                                <KindTag kind={row.kind} />
                              </td>
                              <td class="min-w-0 px-2">
                                <Show
                                  when={row.resultPreview}
                                  fallback={<span class="block truncate">{row.preview || '—'}</span>}
                                >
                                  <span class="grid min-w-0 grid-cols-2 gap-2">
                                    <span class="truncate font-mono">{row.preview}</span>
                                    <span class="truncate text-muted-foreground">{row.resultPreview}</span>
                                  </span>
                                </Show>
                              </td>
                              <td class="px-2 font-mono text-muted-foreground">{formatClock(row.ts)}</td>
                            </tr>
                          )}
                        </For>
                      </>
                    )}
                  </For>
                </tbody>
              </table>
            </section>
            <Inspector
              trace={view().trace}
              row={selectedRow()}
              onClose={() => setSelected(undefined)}
            />
          </div>
        </div>
      )}
    </Show>
  )
}
