import type { SessionListRow } from '@rivus/agent-trace-rpc'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'
import { PreviewPane } from '@/browser/preview-pane.tsx'
import { Rail, type Flags } from '@/browser/rail.tsx'
import { SessionList } from '@/browser/session-list.tsx'
import { createSessionStore } from '@/browser/session-store.ts'
import { openSession } from '@/shell/router.ts'
import { SearchIcon, TopBar } from '@/shell/top-bar.tsx'
import { connectionLost } from '@/shell/connection.ts'
import { ConnectionLost } from '@/shell/connection-lost.tsx'

const SEARCH_DEBOUNCE_MS = 160
/** Rows asked for first when the view changes: about two screens. */
const VISIBLE_FIRST = 40
const PENDING_POLL_MS = 3_000

export function SessionBrowser() {
  const store = createSessionStore()
  const [input, setInput] = createSignal('')
  const [host, setHost] = createSignal<string>()
  const [project, setProject] = createSignal<string>()
  const [flags, setFlags] = createSignal<Flags>({ compaction: false, subagents: false, failed: false })
  const [selected, setSelected] = createSignal<string>()
  const [now, setNow] = createSignal(Date.now())
  let searchBox: HTMLInputElement | undefined
  let listElement: HTMLDivElement | undefined
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  // Host, project, and flag filters are client-side over rows; search is the server's index (3.4, 3.6).
  const visible = createMemo((): SessionListRow[] => {
    const matches = store.matches()
    const f = flags()
    return store.rows().filter(row =>
      (!matches || matches.has(row.ref))
      && (!host() || row.host === host())
      && (!project() || row.project === project())
      && (!f.compaction || (row.compactions ?? 0) > 0)
      && (!f.subagents || (row.subagents ?? 0) > 0)
      && (!f.failed || (row.failedTools ?? 0) > 0))
  })
  const selectedRow = createMemo(() => visible().find(row => row.ref === selected()))

  createEffect(() => {
    const rows = visible()
    if (!rows.some(row => row.ref === selected()))
      setSelected(rows[0]?.ref)
  })

  /** Open a row, unless it could not be read (the same rule as the disabled Open button). */
  function openRow(ref: string | undefined): void {
    const row = ref ? store.rows().find(item => item.ref === ref) : undefined
    if (row && !row.error)
      openSession(row.ref)
  }

  /** Pending rows at the top of the current view: summarized before the rest. */
  const pendingOnScreen = () => visible().slice(0, VISIBLE_FIRST).filter(row => row.pending).map(row => row.ref)

  createEffect(on(() => [host(), project(), flags(), store.matches(), store.loaded()], () => {
    store.prioritize(pendingOnScreen())
  }, { defer: true }))

  function onSearch(value: string): void {
    setInput(value)
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void store.search(value), SEARCH_DEBOUNCE_MS)
  }

  function move(step: number): void {
    const rows = visible()
    if (rows.length === 0)
      return
    const index = rows.findIndex(row => row.ref === selected())
    const next = rows[Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index + step)))]!
    setSelected(next.ref)
    listElement?.querySelector(`[data-ref="${CSS.escape(next.ref)}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  /** Arrow keys and Enter, in the list and in the search box only. */
  function onListKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    }
    else if (event.key === 'Enter' && selected()) {
      event.preventDefault()
      openRow(selected())
    }
  }

  async function onSearchKey(event: KeyboardEvent): Promise<void> {
    if (event.key === 'Escape') {
      searchBox?.blur()
      return
    }
    if (event.key !== 'Enter') {
      onListKey(event)
      return
    }
    event.preventDefault()
    // Run the typed query now, so Enter opens the first match, not the row from before.
    clearTimeout(searchTimer)
    await store.search(input())
    openRow(selected())
  }

  // ⌘K / Ctrl+K is the one global shortcut.
  const onKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      searchBox?.focus()
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey)
    const clock = setInterval(() => setNow(Date.now()), 60_000)
    // Fallback when a push is missed: re-ask while summaries are pending.
    const poll = setInterval(() => {
      if (store.pending() > 0)
        store.prioritize(pendingOnScreen())
    }, PENDING_POLL_MS)
    onCleanup(() => {
      window.removeEventListener('keydown', onKey)
      clearInterval(clock)
      clearInterval(poll)
      clearTimeout(searchTimer)
    })
  })

  const empty = () => store.rows().length === 0 ? t('browser.noSessions') : t('browser.noMatches')

  return (
    <div class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <TopBar onJump={() => searchBox?.focus()} />
      <div class="flex min-h-0 flex-1">
        <Rail
          hosts={store.hosts()}
          rows={store.rows()}
          host={host()}
          project={project()}
          flags={flags()}
          onHost={setHost}
          onProject={setProject}
          onFlag={(flag, value) => setFlags(previous => ({ ...previous, [flag]: value }))}
        />
        <main class="flex min-w-0 flex-1 flex-col">
          <div class="flex flex-col gap-4 border-b border-border px-[18px] pb-[18px] pt-[26px]">
            <div class="flex items-baseline gap-3">
              <h1 class="m-0 text-[26px] font-semibold tracking-[-0.02em]">{t('browser.title')}</h1>
              <span class="text-[14px] text-muted-foreground">
                {t('browser.onThisMachine', { count: formatNumber(store.rows().length, locale()) })}
              </span>
              <Show when={store.pending() > 0}>
                <span class="text-[12px] text-subtle" data-testid="summarizing">
                  {t('browser.summarizing', { count: formatNumber(store.pending(), locale()) })}
                </span>
              </Show>
            </div>
            <div class="flex items-center gap-2.5">
              <label class="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[9px] border border-input bg-muted px-3.5 focus-within:border-ring">
                <SearchIcon size={16} class="shrink-0 text-muted-foreground" />
                <input
                  ref={(element) => { searchBox = element }}
                  type="search"
                  id="session-search"
                  name="session-search"
                  class="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-subtle"
                  placeholder={t('browser.search')}
                  aria-label={t('browser.search')}
                  value={input()}
                  onInput={event => onSearch(event.currentTarget.value)}
                  onKeyDown={event => void onSearchKey(event)}
                />
              </label>
              <div class="flex h-10 shrink-0 items-center rounded-[9px] border border-input px-3.5 text-[13px] text-foreground">
                {t('browser.sortLastActive')}
              </div>
            </div>
            <Show when={!connectionLost() && store.error()}>
              {reason => (
                <div class="flex items-center gap-3" role="alert">
                  <p class="m-0 text-[13px] text-muted-foreground">{t('browser.connectionError', { reason: reason() })}</p>
                  <button type="button" class="rounded-md border border-input px-2.5 py-1 text-[12.5px] text-foreground hover:bg-accent" onClick={() => location.reload()}>
                    {t('common.reload')}
                  </button>
                </div>
              )}
            </Show>
            <Show when={connectionLost()}>
              <ConnectionLost />
            </Show>
          </div>
          <SessionList
            ref={(element) => { listElement = element }}
            hosts={store.hosts()}
            rows={visible()}
            now={now()}
            selected={selected()}
            empty={store.loaded() ? empty() : t('common.loading')}
            onSelect={setSelected}
            onOpen={openRow}
            onKeyDown={onListKey}
          />
          <footer class="flex h-10 shrink-0 items-center gap-2.5 border-t border-border px-[18px] text-[12px] text-subtle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 8 L9 12 L5 16" />
              <path d="M11 16 H19" />
            </svg>
            <span class="font-mono">npx @rivus/agent-trace</span>
            <span>· {t('common.nothingLeaves')}</span>
          </footer>
        </main>
        <PreviewPane row={selectedRow()} hosts={store.hosts()} now={now()} onOpen={openRow} />
      </div>
    </div>
  )
}
