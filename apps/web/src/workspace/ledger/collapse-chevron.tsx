import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons.tsx'

/** The collapse chevron both 40 px headers open with: it never steals focus or bubbles the row click. */
export function CollapseChevron(props: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      tabindex="-1"
      class="grid size-[15px] shrink-0 place-items-center text-muted-foreground"
      aria-hidden="true"
      onClick={event => {
        event.stopPropagation()
        props.onToggle()
      }}
    >
      {props.collapsed ? <ChevronRightIcon size={15} /> : <ChevronDownIcon size={15} />}
    </button>
  )
}
