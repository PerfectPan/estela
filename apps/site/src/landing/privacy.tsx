import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { SectionHeading } from './section-heading.tsx'

export function Privacy({ t, sectionId, headingId }: { t: Dictionary; sectionId: string; headingId: string }) {
  return (
    <section aria-labelledby={headingId} id={sectionId} className="mx-auto max-w-[1240px] px-5 py-24 md:px-8 md:py-32">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-20">
        <SectionHeading id={headingId} eyebrow={t.privacy.eyebrow} title={t.privacy.title} />
        <ol className="grid gap-x-10 sm:grid-cols-2">
          {t.privacy.items.map((item, index) => (
            <li key={item.title} className="border-t border-border py-6">
              <span className="font-mono text-[12px] text-subtle">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="mt-2 text-[17px] font-semibold">{item.title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
