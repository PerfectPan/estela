import type { Locale } from '@/i18n/locale.ts'
import { useLanguage } from '@/hooks/use-language.ts'
import { dictionaryOf } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva.ts'
import { AgentsGrid } from './agents-grid.tsx'
import { Answers } from './answers.tsx'
import { Commands } from './commands.tsx'
import { DocsLinks } from './docs-links.tsx'
import { Elsewhere } from './elsewhere.tsx'
import { Hero } from './hero.tsx'
import { LiveDemo } from './live-demo.tsx'
import { Privacy } from './privacy.tsx'
import { SiteFooter } from './site-footer.tsx'
import { SiteHeader } from './site-header.tsx'

// Both trees are prerendered; <html lang>, which the boot script sets before hydration, picks the visible one.
const TREE_VISIBILITY: Record<Locale, string> = {
  en: 'in-[html[lang="zh-CN"]]:invisible in-[html[lang="zh-CN"]]:pointer-events-none',
  'zh-CN': 'invisible pointer-events-none in-[html[lang="zh-CN"]]:visible in-[html[lang="zh-CN"]]:pointer-events-auto',
}

function idFor(locale: Locale, active: boolean, id: string): string {
  return active ? id : `${locale}-${id}`
}

export function LandingPage({ locale }: { locale: Locale }) {
  const { lang } = useLanguage()
  const active = lang === locale
  const t = dictionaryOf(locale)

  return (
    <div
      lang={locale}
      data-lang={locale}
      aria-hidden={!active}
      className={cx(TREE_VISIBILITY[locale], 'col-start-1 row-start-1 min-w-0')}
    >
      <SiteHeader locale={locale} t={t} />
      <main id={idFor(locale, active, 'main')}>
        <Hero locale={locale} t={t} topId={idFor(locale, active, 'top')} />
        <Answers
          t={t}
          sectionId={idFor(locale, active, 'features')}
          headingId={idFor(locale, active, 'features-title')}
        />
        <LiveDemo t={t} sectionId={idFor(locale, active, 'demo')} headingId={idFor(locale, active, 'demo-title')} />
        <Commands t={t} headingId={idFor(locale, active, 'commands-title')} />
        <Elsewhere t={t} headingId={idFor(locale, active, 'elsewhere-title')} />
        <AgentsGrid
          t={t}
          sectionId={idFor(locale, active, 'agents')}
          headingId={idFor(locale, active, 'agents-title')}
        />
        <Privacy
          t={t}
          sectionId={idFor(locale, active, 'privacy')}
          headingId={idFor(locale, active, 'privacy-title')}
        />
        <DocsLinks
          locale={locale}
          t={t}
          sectionId={idFor(locale, active, 'docs')}
          headingId={idFor(locale, active, 'docs-title')}
        />
      </main>
      <SiteFooter t={t} />
    </div>
  )
}
