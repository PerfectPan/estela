import { ThemeSwitch } from 'fumadocs-ui/layouts/shared/slots/theme-switch'
import { GithubIcon } from '@/components/icons.tsx'
import { buttonVariants } from '@/components/ui/button.tsx'
import { REPOSITORY } from '@/content/links.ts'
import { useLanguage } from '@/hooks/use-language.ts'
import { dictionaryOf } from '@/i18n/locale.ts'
import { LanguageSwitch } from '@/landing/language-switch.tsx'

/** One quiet row at the bottom of the docs sidebar: repository link, language, and theme. */
export function DocsSidebarFooter() {
  const { lang } = useLanguage()
  const t = dictionaryOf(lang)

  return (
    <div className="flex items-center gap-1.5">
      <a
        href={REPOSITORY}
        aria-label={t.hero.source}
        rel="noopener"
        target="_blank"
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <GithubIcon />
      </a>
      <LanguageSwitch locale={lang} t={t} className="ms-auto" />
      <ThemeSwitch className="border-0 bg-transparent p-0" />
    </div>
  )
}
