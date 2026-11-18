import { Link } from '@tanstack/react-router'
import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { Locale } from '@/i18n/locale.ts'
import { ArrowRightIcon } from '@/components/icons.tsx'
import { DOC_LINKS } from '@/content/links.ts'
import { InstallCommand } from './install-command.tsx'
import { SectionHeading } from './section-heading.tsx'

const SITE_DOC_SPLATS: Record<string, string> = {
  guide: 'guide',
  reference: 'reference/public-interface',
  architecture: 'architecture/overview',
  design: 'design',
}

const cardClass =
  'group flex h-full flex-col rounded-xl border border-border p-5 transition-colors hover:border-input hover:bg-secondary'

export function DocsLinks({
  locale,
  t,
  sectionId,
  headingId,
}: {
  locale: Locale
  t: Dictionary
  sectionId: string
  headingId: string
}) {
  return (
    <section aria-labelledby={headingId} id={sectionId} className="border-t border-border">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-24 md:px-8 md:py-32 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-20">
        <div>
          <SectionHeading id={headingId} eyebrow={t.docs.eyebrow} title={t.docs.title} />
          <div className="mt-8">
            <InstallCommand t={t} />
          </div>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {t.docs.links.map(link => {
            const splat = SITE_DOC_SPLATS[link.id]
            const content = (
              <>
                <span className="flex items-center justify-between font-semibold">
                  {link.label}
                  <ArrowRightIcon className="text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </span>
                <span className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{link.body}</span>
              </>
            )
            return (
              <li key={link.id}>
                {splat ? (
                  <Link to="/docs/$" params={{ _splat: splat }} className={cardClass}>
                    {content}
                  </Link>
                ) : (
                  <a href={DOC_LINKS[link.id]?.[locale]} rel="noopener" className={cardClass}>
                    {content}
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
