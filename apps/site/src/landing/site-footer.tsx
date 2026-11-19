import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { CHANGELOG, NPM, REPOSITORY, SECURITY } from '@/content/links.ts'
import { SiteLogo } from './site-logo.tsx'

export function SiteFooter({ t }: { t: Dictionary }) {
  const links = [
    { href: REPOSITORY, label: 'GitHub' },
    { href: NPM, label: 'npm' },
    { href: CHANGELOG, label: t.footer.changelog },
    { href: SECURITY, label: t.footer.security },
  ]
  return (
    <footer className="border-t border-border bg-secondary">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2.5 font-semibold">
            <SiteLogo size={18} />
            Estela
            <span className="font-mono text-[12px] font-normal text-muted-foreground">· {t.footer.license}</span>
          </span>
          <span className="text-[13px] text-muted-foreground italic">{t.footer.wake}</span>
        </div>
        <nav aria-label={t.nav.footer} className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-muted-foreground">
          {links.map(link => (
            <a key={link.label} href={link.href} rel="noopener" className="transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  )
}
