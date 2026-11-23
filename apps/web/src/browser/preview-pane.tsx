import type { AgentListEntry, SessionListRow } from '@rivus/estela-rpc'
import { Show } from 'solid-js'
import { SessionPreview } from '@/browser/session-preview.tsx'

/** Right pane (340 px): the selected row's shape, headline numbers, first prompt, and "Open session". */
export function PreviewPane(props: {
  row?: SessionListRow
  agents: AgentListEntry[]
  /** The price snapshot the rows' costs are priced at. */
  pricesVersion?: string
  now: number
  onOpen: (traceId: string) => void
}) {
  return (
    <aside class="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-secondary p-[22px]">
      <Show when={props.row}>
        {row => (
          <SessionPreview
            row={row()}
            agents={props.agents}
            pricesVersion={props.pricesVersion}
            now={props.now}
            onOpen={props.onOpen}
          />
        )}
      </Show>
    </aside>
  )
}
