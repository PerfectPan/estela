import type { JSX } from 'solid-js'

export function TimelineLegend(props: { mark: JSX.Element; children: JSX.Element }) {
  return (
    <li class="flex items-center gap-1.5 whitespace-nowrap">
      <span class="flex items-center" aria-hidden="true">
        {props.mark}
      </span>
      <span>{props.children}</span>
    </li>
  )
}
