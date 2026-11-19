import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { SectionHeading } from './section-heading.tsx'

export function Elsewhere({ t, headingId }: { t: Dictionary; headingId: string }) {
  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-[1240px] px-5 pb-24 md:px-8 md:pb-32">
      <SectionHeading id={headingId} eyebrow={t.elsewhere.eyebrow} title={t.elsewhere.title} />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {t.elsewhere.items.map(item => (
          <article key={item.name} className="flex flex-col rounded-xl border border-border p-6">
            <h3 className="text-[19px] font-semibold tracking-[-0.015em]">{item.name}</h3>
            <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">{item.body}</p>
            <code className="mt-6 block truncate rounded-md border border-border bg-secondary px-3 py-2 font-mono text-[12.5px] text-foreground">
              {item.command}
            </code>
          </article>
        ))}
      </div>
    </section>
  )
}
