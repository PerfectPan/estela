import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceContext } from './types.ts'

type EstelaTheme = 'light' | 'dark'
type EstelaLocale = 'en' | 'zh-CN'

export interface AppearanceTarget {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

/** @internal Maps a dsh theme snapshot to Estela's `data-theme` attribute value. */
export function resolveEstelaTheme(snapshot: Pick<ThemeSnapshot, 'active'>): EstelaTheme {
  return snapshot.active.colorScheme === 'light' ? 'light' : 'dark'
}

/** @internal Maps a dsh locale snapshot to Estela's `lang` attribute value (`zh*` -> `zh-CN`, else `en`). */
export function resolveEstelaLocale(snapshot: Pick<LocaleSnapshot, 'active'>): EstelaLocale {
  return snapshot.active.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function writeAttribute(target: AppearanceTarget, name: string, value: string): void {
  if (target.getAttribute(name) !== value) {
    target.setAttribute(name, value)
  }
}

/**
 * Syncs dsh's active theme and locale onto the mounted `<estela-workspace>` element and
 * subscribes to live changes inside `ctx.effect`. Never writes `document.documentElement`.
 */
export function bindAppearance(ctx: AppearanceContext, target: AppearanceTarget): () => void {
  writeAttribute(target, 'data-theme', resolveEstelaTheme(ctx.theme.getTheme()))
  writeAttribute(target, 'lang', resolveEstelaLocale(ctx.locale.getLocale()))

  return ctx.effect(() => {
    const stopTheme = ctx.on('theme/change', snapshot => {
      writeAttribute(target, 'data-theme', resolveEstelaTheme(snapshot))
    })
    const stopLocale = ctx.on('locale/change', snapshot => {
      writeAttribute(target, 'lang', resolveEstelaLocale(snapshot))
    })
    return () => {
      stopTheme()
      stopLocale()
    }
  }, 'estela: appearance')
}
