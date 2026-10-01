import type { JSX } from 'solid-js'

/** Stroke icons from the design mockups (24 px grid, 1.8 stroke, `currentColor`). */
function Icon(props: { size?: number; class?: string; children: JSX.Element }) {
  return (
    <svg
      width={props.size ?? 14}
      height={props.size ?? 14}
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

type IconProps = { size?: number; class?: string }

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6 L15 12 L9 18" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9 L12 15 L18 9" />
    </Icon>
  )
}

/** Failed tool calls only: the one place the error color appears. */
export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4 L21 19 H3 Z" />
      <path d="M12 10 V13.5" />
      <path d="M12 16.3 V16.4" />
    </Icon>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 12 C5 7 8.5 5 12 5 C15.5 5 19 7 21.5 12 C19 17 15.5 19 12 19 C8.5 19 5 17 2.5 12 Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 L10 17 L19 7" />
    </Icon>
  )
}

export function ExportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4 V15" />
      <path d="M7.5 8.5 L12 4 L16.5 8.5" />
      <path d="M5 14 V19 H19 V14" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 7 L17 17 M17 7 L7 17" />
    </Icon>
  )
}

export function HooksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 9 H19 M5 15 H19" />
    </Icon>
  )
}

export function CompactIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7 H20 M4 17 H20" />
      <path d="M9 10.5 L12 13.5 L15 10.5" />
    </Icon>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12 H19 M13 6 L19 12 L13 18" />
    </Icon>
  )
}

export function SearchIcon(props: { size?: number; class?: string }) {
  return (
    <svg
      width={props.size ?? 14}
      height={props.size ?? 14}
      class={props.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16 L20.5 20.5" />
    </svg>
  )
}

export function SystemIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M9 20 H15 M12 16.5 V20" />
    </svg>
  )
}

export function SunIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M5.6 18.4 L7 17 M17 7 L18.4 5.6" />
    </svg>
  )
}

export function MoonIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />
    </svg>
  )
}
