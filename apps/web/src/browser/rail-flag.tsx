import { Show } from 'solid-js'

export function RailFlag(props: { name: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="flex h-7 cursor-pointer items-center gap-[9px] px-2.5 text-[13px] text-muted-foreground hover:text-foreground">
      <input
        type="checkbox"
        name={props.name}
        id={props.name}
        class="peer sr-only"
        checked={props.checked}
        onChange={event => props.onChange(event.currentTarget.checked)}
      />
      <span
        class={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${props.checked ? 'border-kind-request bg-kind-request' : 'border-input'}`}
        aria-hidden="true"
      >
        <Show when={props.checked}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--background)"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12.5 L10 17 L19 7" />
          </svg>
        </Show>
      </span>
      {props.label}
    </label>
  )
}
