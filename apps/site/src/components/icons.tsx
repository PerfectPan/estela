import type { ReactNode } from 'react'

type IconProps = { readonly size?: number; readonly className?: string }

/** Stroke icons on the product's grid (24 px, 1.8 stroke, `currentColor`). */
function Icon({ size = 16, className, children }: IconProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5 V6.5 A2 2 0 0 0 13.5 4.5 H6.5 A2 2 0 0 0 4.5 6.5 V13.5 A2 2 0 0 0 6.5 15.5 H8.5" />
    </Icon>
  )
}

/* jscpd:ignore-start -- apps/site imports no workspace code by design; these SVG icon paths stay duplicated from apps/web/src/components/icons.tsx. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 L10 17.5 L19 7" />
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
/* jscpd:ignore-end */

export function ExternalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4.5 H19.5 V10 M19.5 4.5 L11 13" />
      <path d="M17 14 V18 A1.5 1.5 0 0 1 15.5 19.5 H6 A1.5 1.5 0 0 1 4.5 18 V8.5 A1.5 1.5 0 0 1 6 7 H10" />
    </Icon>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5 V4.5 M12 19.5 V21.5 M2.5 12 H4.5 M19.5 12 H21.5 M5.3 5.3 L6.7 6.7 M17.3 17.3 L18.7 18.7 M5.3 18.7 L6.7 17.3 M17.3 6.7 L18.7 5.3" />
    </Icon>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />
    </Icon>
  )
}

/** The GitHub mark, filled; its paths are GitHub's published logo. */
export function GithubIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
