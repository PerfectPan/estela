import type { ReactNode } from 'react'

export function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  children?: ReactNode
}) {
  return (
    <div className="max-w-[760px]">
      <p className="eyebrow mb-4">{eyebrow}</p>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {children ? (
        <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed text-muted-foreground">{children}</p>
      ) : null}
    </div>
  )
}
