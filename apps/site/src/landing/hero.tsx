import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { Locale } from '@/i18n/locale.ts'
import { ArrowRightIcon, GithubIcon } from '@/components/icons/index.ts'
import { buttonVariants } from '@/components/ui/button.tsx'
import { REPOSITORY } from '@/content/links.ts'
import { WakeScene } from '@/scene/wake-scene.tsx'
import { InstallCommand } from './install-command.tsx'

export function Hero({ locale, t, topId }: { locale: Locale; t: Dictionary; topId: string }) {
  const hero = t.hero
  return (
    <section id={topId} className="relative isolate overflow-hidden border-b border-border">
      <div aria-hidden="true" className="axis-grid absolute inset-0 -z-10" />
      <div
        aria-hidden="true"
        className="absolute top-[-10%] right-[-10%] -z-10 h-[90%] w-[70%] rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]"
      />
      <div className="mx-auto grid max-w-[1240px] px-5 md:px-8 lg:min-h-[min(820px,calc(100svh-56px))] lg:grid-cols-[minmax(0,560px)_1fr] lg:items-center">
        <div className="relative z-10 pt-14 pb-6 md:pt-20 lg:py-24">
          <p className="eyebrow mb-6 flex items-center gap-2.5">
            <span className="inline-block size-2 rounded-[2px] bg-kind-request" aria-hidden="true" />
            {hero.eyebrow}
          </p>
          <h1 className="display display-zh-size text-[clamp(42px,6.2vw,80px)]">
            {hero.titleLead}
            <span className="display-tail text-muted-foreground">{hero.titleTail}</span>
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-muted-foreground">{hero.lead}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <InstallCommand t={t} />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="#demo" className={buttonVariants({ size: 'lg' })}>
              {hero.demo}
              <ArrowRightIcon />
            </a>
            <a href={REPOSITORY} rel="noopener" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              <GithubIcon />
              {hero.source}
            </a>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[12px] text-muted-foreground">
            {hero.facts.map(fact => (
              <li key={fact} className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-subtle" aria-hidden="true" />
                {fact}
              </li>
            ))}
          </ul>
        </div>
        <WakeScene
          locale={locale}
          t={t}
          className="-mx-5 h-[380px] sm:h-[460px] md:-mx-8 lg:absolute lg:inset-y-0 lg:right-0 lg:mx-0 lg:h-auto lg:w-[60%] lg:[mask-image:linear-gradient(to_right,transparent,#000_18%)]"
        />
      </div>
    </section>
  )
}
