import type { ComponentProps } from 'react'
import { Link } from '@tanstack/react-router'
import { SiteLogo } from '@/landing/site-logo.tsx'
import { cx } from '@/lib/cva.ts'

/** Sidebar wordmark. Exact matching keeps the landing link inactive on nested docs routes. */
export function DocsBrand({ className }: ComponentProps<'a'>) {
  return (
    <Link
      to="/"
      className={cx('group/brand flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em]', className)}
      activeOptions={{ exact: true }}
    >
      <SiteLogo />
      <span>Estela</span>
    </Link>
  )
}
