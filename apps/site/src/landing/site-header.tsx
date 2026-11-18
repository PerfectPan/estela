import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { Locale } from '@/i18n/locale.ts'
import { GithubIcon } from '@/components/icons.tsx'
import { buttonVariants } from '@/components/ui/button.tsx'
import { REPOSITORY } from '@/content/links.ts'
import { LanguageSwitch } from './language-switch.tsx'
import { SiteLogo } from './site-logo.tsx'
import { ThemeToggle } from './theme-toggle.tsx'

export function SiteHeader({ locale, t }: { locale: Locale; t: Dictionary }) {
  const anchors = [
    { href: '#features', label: t.nav.features },
    { href: '#demo', label: t.nav.demo },
    { href: '#agents', label: t.nav.agents },
    { href: '#privacy', label: t.nav.privacy },
    { href: '#docs', label: t.nav.docs },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <a
        href="#main"
        className="sr-only rounded-md bg-muted px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        {t.nav.skip}
      </a>
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-5 md:px-8">
        <a href="#top" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.01em]">
          <SiteLogo />
          Estela
        </a>
        <nav aria-label={t.nav.label} className="hidden items-center gap-1 lg:flex">
          {anchors.map(anchor => (
            <a
              key={anchor.href}
              href={anchor.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {anchor.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={REPOSITORY}
            className={buttonVariants({ variant: 'ghost', className: 'hidden sm:inline-flex' })}
            rel="noopener"
          >
            <GithubIcon />
            GitHub
          </a>
          <LanguageSwitch locale={locale} t={t} />
          <ThemeToggle t={t} />
        </div>
      </div>
    </header>
  )
}
