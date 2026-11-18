import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { SectionHeading } from './section-heading.tsx'

export function Commands({ t, headingId }: { t: Dictionary; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-[1240px] px-5 py-24 md:px-8 md:py-32">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-20">
        <SectionHeading id={headingId} eyebrow={t.commands.eyebrow} title={t.commands.title}>
          {t.commands.lead}
        </SectionHeading>
        <dl className="divide-y divide-border self-start rounded-xl border border-border bg-secondary">
          {t.commands.rows.map(row => (
            <div
              key={row.command}
              className="grid gap-1.5 px-5 py-4 md:grid-cols-[minmax(0,1.15fr)_1fr] md:items-baseline md:gap-6"
            >
              <dt className="font-mono text-[13px] break-all text-foreground">
                <span className="mr-2 text-subtle select-none" aria-hidden="true">
                  $
                </span>
                {row.command}
              </dt>
              <dd className="text-[14px] text-muted-foreground">{row.what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
