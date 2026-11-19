import type { Dictionary } from '@/i18n/dictionary.en.ts'
import type { Locale } from '@/i18n/locale.ts'
import { useLanguage } from '@/hooks/use-language.ts'
import { LOCALES } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva.ts'

/** Both language trees are prerendered at one URL, so the switch updates the active language in place. */
export function LanguageSwitch({ locale, t, className }: { locale: Locale; t: Dictionary; className?: string }) {
  const { setLang } = useLanguage()
  return (
    <nav
      aria-label={t.nav.language}
      className={cx('flex rounded-md border border-border bg-secondary p-0.5', className)}
    >
      {LOCALES.map(entry => {
        const selected = entry.locale === locale
        return (
          <button
            key={entry.locale}
            type="button"
            lang={entry.locale}
            aria-pressed={selected}
            onClick={() => {
              if (!selected) {
                setLang(entry.locale)
              }
            }}
            className="cursor-pointer rounded-[5px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--input)]"
          >
            {entry.label}
          </button>
        )
      })}
    </nav>
  )
}
