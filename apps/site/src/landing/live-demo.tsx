import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { ExternalIcon } from '@/components/icons/index.ts'
import { buttonVariants } from '@/components/ui/button.tsx'
import { SectionHeading } from './section-heading.tsx'

/** The report scripts/build-demo.mjs writes into the site output with the CLI's `build` command. */
const DEMO_URL = `${import.meta.env.BASE_URL}demo/`

export function LiveDemo({ t, sectionId, headingId }: { t: Dictionary; sectionId: string; headingId: string }) {
  const demo = t.demo
  return (
    <section aria-labelledby={headingId} id={sectionId} className="border-y border-border bg-secondary">
      <div className="mx-auto max-w-[1240px] px-5 py-24 md:px-8 md:py-32">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading id={headingId} eyebrow={demo.eyebrow} title={demo.title}>
            {demo.lead}
          </SectionHeading>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ size: 'lg', variant: 'outline' })}
          >
            {demo.open}
            <ExternalIcon />
          </a>
        </div>
        <figure className="mt-12 overflow-hidden rounded-xl border border-input bg-background shadow-[0_40px_120px_-40px_color-mix(in_srgb,var(--kind-request)_35%,transparent)]">
          <figcaption className="flex h-10 items-center gap-3 border-b border-border px-4 font-mono text-[12px] text-muted-foreground">
            <span className="size-2 rounded-full bg-kind-user" aria-hidden="true" />
            <span className="truncate">npx @rivus/estela build → demo/index.html</span>
          </figcaption>
          <iframe
            src={DEMO_URL}
            title={demo.frame}
            loading="lazy"
            className="hidden h-[min(760px,78vh)] w-full md:block"
          />
          <p className="p-6 text-muted-foreground md:hidden">{demo.small}</p>
        </figure>
      </div>
    </section>
  )
}
