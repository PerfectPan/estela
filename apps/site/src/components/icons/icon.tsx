import type { ReactNode } from 'react'

export interface IconProps {
  readonly size?: number
  readonly className?: string
}

/** Stroke icons on the product's grid (24 px, 1.8 stroke, `currentColor`). */
export function Icon({ size = 16, className, children }: IconProps & { readonly children: ReactNode }) {
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
