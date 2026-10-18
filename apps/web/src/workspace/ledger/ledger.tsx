import type { VirtualRow } from '@/lib/ledger-model.ts'
import type { WorkspaceState } from '../workspace-state.ts'
import type { RowContext } from './row-frame.tsx'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { For, Show, createEffect, createMemo, on } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { anchorIndex, moveSelection } from '@/lib/ledger-model.ts'
import { LedgerToolbar } from './ledger-toolbar.tsx'
import { LedgerRowBody } from './ledger-row-body.tsx'

/** Rows drawn above and below the viewport. With 36 px rows the DOM holds about 40 rows (S8: under 100). */
const OVERSCAN = 10

function rowId(key: string): string {
  return `ledger-row-${key.replace(/[^\w-]/g, '_')}`
}

/**
 * The ledger: turns from `projectTurns` with hook runs folded, virtualized with
 * `@tanstack/solid-virtual` at fixed row heights. A listbox: up / down move the selection,
 * Enter / Space toggle a turn, a subagent lane, or a hook run.
 */
export function Ledger(props: { state: WorkspaceState; start: number }) {
  let scroller: HTMLDivElement | undefined
  const state = props.state
  const rows = state.rows
  const ctx = createMemo((): RowContext => ({ model: state.model, start: props.start, dim: state.dim() }))
  // Turn 0 without a prompt is "Before the first prompt"; numbering then starts at its successor.
  const offset = state.model.turns[0]?.turn.promptEventId ? 1 : 0
  const turnNumber = (index: number, hasPrompt: boolean) => (hasPrompt || index > 0 ? index + offset : undefined)

  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scroller ?? null,
    estimateSize: index => rows()[index]?.size ?? 36,
    getItemKey: index => rows()[index]?.key ?? index,
    overscan: OVERSCAN,
  })
  // Row sizes are fixed per type but the list changes shape on collapse or filter.
  createEffect(on(rows, () => virtualizer.measure(), { defer: true }))

  const selectedIndex = createMemo(() => {
    const key = state.selectedKey()
    return key ? rows().findIndex(row => row.key === key) : -1
  })
  /** Where the keyboard continues from: the selected row, or its turn header when a filter hides it. */
  const anchor = createMemo(() => anchorIndex(rows(), state.model, state.selectedKey()))
  /** `aria-activedescendant` names only a row the virtualizer has drawn. */
  const activeId = () => {
    const index = selectedIndex()
    if (index < 0 || !virtualizer.getVirtualItems().some(item => item.index === index)) {
      return undefined
    }
    return rowId(rows()[index]!.key)
  }
  createEffect(
    on(
      selectedIndex,
      index => {
        if (index >= 0) {
          virtualizer.scrollToIndex(index, { align: 'auto' })
        }
      },
      { defer: true },
    ),
  )

  function activate(row: VirtualRow): void {
    if (row.type === 'turn') {
      state.toggleTurn(row.group.id)
    } else if (row.entry.type === 'subagent' || row.entry.type === 'hooks') {
      state.toggleEntry(row.entry.id)
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const list = rows()
    let next: number | undefined
    const from = anchor()
    // A hidden selection continues from its turn header: ArrowDown moves past it, ArrowUp lands on it.
    const hidden = from >= 0 && from !== selectedIndex()
    const step = (delta: number) => (hidden && delta < 0 ? from : moveSelection(list.length, from, delta))
    if (event.key === 'ArrowDown') {
      next = step(1)
    } else if (event.key === 'ArrowUp') {
      next = step(-1)
    } else if (event.key === 'PageDown') {
      next = step(10)
    } else if (event.key === 'PageUp') {
      next = step(-10)
    } else if (event.key === 'Home') {
      next = list.length > 0 ? 0 : -1
    } else if (event.key === 'End') {
      next = list.length - 1
    } else if (event.key === 'Enter' || event.key === ' ') {
      const row = list[selectedIndex()]
      if (row) {
        event.preventDefault()
        activate(row)
      }
      return
    }
    if (next === undefined) {
      return
    }
    event.preventDefault()
    const row = list[next]
    if (row) {
      state.setSelectedKey(row.key)
    }
  }

  return (
    <section class="flex min-w-0 flex-1 flex-col" aria-label={t('ledger.label')}>
      <LedgerToolbar
        filter={state.filter()}
        onFilter={state.setFilter}
        failures={state.failures}
        dim={state.dim()}
        onDim={state.setDim}
      />
      <div
        ref={element => {
          scroller = element
        }}
        class="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--selection-ring)]"
        role="listbox"
        tabindex="0"
        aria-label={t('ledger.label')}
        aria-activedescendant={activeId()}
        data-testid="ledger"
        onKeyDown={onKeyDown}
      >
        <Show
          when={rows().length > 0}
          fallback={<p class="m-0 px-5 py-6 text-[13px] text-subtle">{t('ledger.noEvents')}</p>}
        >
          <div class="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            <For each={virtualizer.getVirtualItems()}>
              {item => {
                const row = () => rows()[item.index]
                return (
                  <Show when={row()}>
                    {current => (
                      <div
                        id={rowId(current().key)}
                        role="option"
                        aria-selected={state.selectedKey() === current().key}
                        aria-expanded={
                          current().type === 'turn'
                            ? !(current() as Extract<VirtualRow, { type: 'turn' }>).collapsed
                            : undefined
                        }
                        data-row-type={
                          current().type === 'turn'
                            ? 'turn'
                            : (current() as Extract<VirtualRow, { type: 'entry' }>).entry.type
                        }
                        class={cx(
                          'absolute top-0 left-0 w-full cursor-default',
                          state.selectedKey() === current().key
                            ? 'bg-selection shadow-[inset_0_0_0_1px_var(--selection-ring)]'
                            : 'hover:bg-accent/60',
                        )}
                        style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                        onClick={() => {
                          state.setSelectedKey(current().key)
                          if (current().type === 'turn') {
                            activate(current())
                          }
                        }}
                      >
                        <LedgerRowBody row={current()} ctx={ctx()} number={turnNumber} state={state} />
                      </div>
                    )}
                  </Show>
                )
              }}
            </For>
          </div>
        </Show>
      </div>
    </section>
  )
}
