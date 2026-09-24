import type { TraceView } from '@rivus/agent-trace-rpc'
import type { LedgerRow } from '@/lib/ledger'
import { For, Show, createMemo, createResource, createSignal } from 'solid-js'
import { Inspector } from '@/components/inspector'
import { KindTag } from '@/components/kind-tag'
import { translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { buildLedger, formatClock } from '@/lib/ledger'
import { fetchTrace } from '@/workspace/trace-source.ts'
import { TopBar } from '@/shell/top-bar.tsx'

export function Workspace(props: { sessionRef: string }) {
  const [boot] = createResource(() => props.sessionRef, fetchTrace)
  // Reading an errored resource throws; read it only when it is ready.
  const loaded = () => boot.state === 'ready' ? boot() : undefined
  const [selected, setSelected] = createSignal<string>()
  const [query, setQuery] = createSignal('')
  const sections = createMemo(() => {
    const view = loaded()
    return view ? buildLedger(view.trace) : []
  })
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
  const crumbs = () => {
    const session = loaded()?.trace.session
    const project = session?.cwd?.split('/').filter(Boolean).pop()
    return [project, session?.title].filter((part): part is string => Boolean(part))
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TopBar crumbs={crumbs()} onJump={() => document.getElementById('ledger-search')?.focus()} />
      <Show when={boot.error}>
        {reason => (
          <div class="flex flex-1 flex-col items-start gap-3 px-6 py-8">
            <h1 class="text-[22px] font-semibold">{t('workspace.couldNotOpen')}</h1>
            <p class="max-w-3xl whitespace-pre-wrap text-[13px] text-muted-foreground">{messageOf(reason())}</p>
            <a href="#/" class="text-[13px] text-link">{t('workspace.back')}</a>
          </div>
        )}
      </Show>
      <Show when={loaded()} keyed>
        {(view: TraceView) => (
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex h-8 shrink-0 items-center gap-2 border-b border-border px-1.5" role="toolbar">
              <a href="#/" class="px-1.5 text-[12px] text-muted-foreground">{t('workspace.back')}</a>
              <span class="rounded-sm bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">{view.trace.host.id}</span>
              <span class="flex-1" />
              <input
                id="ledger-search"
                name="ledger-search"
                class="h-5 w-44 rounded-sm border border-border bg-background px-2 text-[12px] outline-none placeholder:text-subtle"
                placeholder={t('workspace.search')}
                value={query()}
                onInput={event => setQuery(event.currentTarget.value)}
              />
            </div>
            <div class="flex min-h-0 flex-1 overflow-hidden">
              <section class="min-w-[280px] flex-1 overflow-auto">
                <table class="w-full table-fixed border-collapse text-[12px]">
                  <thead class="sticky top-0 z-10 bg-muted">
                    <tr class="h-[30px] text-left text-muted-foreground">
                      <th class="w-[122px] px-2 font-medium">{t('workspace.event')}</th>
                      <th class="px-2 font-medium">{t('workspace.content')}</th>
                      <th class="w-[88px] px-2 font-medium">{t('workspace.time')}</th>
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
                                <td class="px-2"><KindTag kind={row.kind} /></td>
                                <td class="min-w-0 px-2">
                                  <Show when={row.resultPreview} fallback={<span class="block truncate">{row.preview || t('common.dash')}</span>}>
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
              <Inspector trace={view.trace} row={selectedRow()} onClose={() => setSelected(undefined)} />
            </div>
          </div>
        )}
      </Show>
      <Show when={boot.loading}>
        <div class="grid flex-1 place-items-center text-[12px] text-muted-foreground">{t('common.loading')}</div>
      </Show>
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
