import type { JSX } from 'solid-js'

export function RailGroup(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="rail-label px-2.5 pb-1.5 text-subtle">{props.label}</span>
      {props.children}
    </div>
  )
}
