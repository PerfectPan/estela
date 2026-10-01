import type { MessageKey } from '@/i18n/locale.ts'
import type { ThemeMode } from '@/shell/theme.ts'
import { For, Match, Switch } from 'solid-js'
import { chooseLocale, locale, translate as t } from '@/i18n/locale.ts'
import { chooseTheme, nextThemeMode, themeMode } from '@/shell/theme.ts'

const THEME_LABEL: Record<ThemeMode, MessageKey> = {
  system: 'common.themeSystem',
  light: 'common.themeLight',
  dark: 'common.themeDark',
}

const themeLabel = () => t('common.themeSwitch', {
  mode: t(THEME_LABEL[themeMode()]),
  next: t(THEME_LABEL[nextThemeMode(themeMode())]),
})

/**
 * The shared 52 px top bar of both screens: logo, breadcrumbs, the jump box, and the
 * theme and language switches.
 */
export function TopBar(props: { crumbs?: string[], onJump?: () => void }) {
  const crumbs = () => props.crumbs ?? []
  return (
    <header class="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-5">
      <div class="flex min-w-0 items-center gap-3.5">
        <a href="#/" class="flex shrink-0 items-center gap-2.5 text-foreground">
          <Logo />
          <span class="text-[15px] font-semibold tracking-[-0.01em]">{t('common.appName')}</span>
        </a>
        <nav class="flex min-w-0 items-center gap-2.5 text-[13px]">
          <span class="text-subtle">/</span>
          <a href="#/" class={crumbs().length > 0 ? 'text-muted-foreground hover:text-foreground' : 'text-foreground'}>
            {t('common.sessions')}
          </a>
          <For each={crumbs()}>
            {(crumb, index) => (
              <>
                <span class="text-subtle">/</span>
                <span class={`truncate ${index() === crumbs().length - 1 ? 'text-foreground' : 'text-muted-foreground'}`}>{crumb}</span>
              </>
            )}
          </For>
        </nav>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          class="flex h-8 w-[260px] items-center gap-2 rounded-lg border border-border bg-muted px-2.5 text-left text-[13px] text-subtle hover:border-input"
          onClick={() => props.onJump?.()}
        >
          <SearchIcon />
          <span class="min-w-0 flex-1 truncate">{t('common.jumpTo')}</span>
          <span class="rounded border font-mono border-input px-[5px] py-px text-[11px] text-subtle">⌘K</span>
        </button>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-lg border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={themeLabel()}
          title={themeLabel()}
          data-testid="theme-switch"
          data-mode={themeMode()}
          onClick={() => chooseTheme(nextThemeMode(themeMode()))}
        >
          <Switch>
            <Match when={themeMode() === 'system'}><SystemIcon /></Match>
            <Match when={themeMode() === 'light'}><SunIcon /></Match>
            <Match when={themeMode() === 'dark'}><MoonIcon /></Match>
          </Switch>
        </button>
        <button
          type="button"
          class="grid h-8 font-mono min-w-8 place-items-center rounded-lg border border-input px-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t('common.languageSwitch')}
          title={t('common.languageSwitch')}
          data-testid="language-switch"
          onClick={() => chooseLocale(locale() === 'en' ? 'zh-CN' : 'en')}
        >
          {t('common.languageShort')}
        </button>
      </div>
    </header>
  )
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 17 L8.5 9 L13 14 L21 5" stroke="var(--foreground)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="3" cy="17" r="2" fill="var(--background)" stroke="var(--kind-request)" stroke-width="1.6" />
      <circle cx="8.5" cy="9" r="2" fill="var(--background)" stroke="var(--foreground)" stroke-width="1.6" />
      <circle cx="13" cy="14" r="2" fill="var(--background)" stroke="var(--foreground)" stroke-width="1.6" />
      <circle cx="21" cy="5" r="2" fill="var(--kind-request)" />
    </svg>
  )
}

export function SearchIcon(props: { size?: number, class?: string }) {
  return (
    <svg width={props.size ?? 14} height={props.size ?? 14} class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16 L20.5 20.5" />
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
      <path d="M9 20 H15 M12 16.5 V20" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M5.6 18.4 L7 17 M17 7 L18.4 5.6" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 14.5 A8 8 0 1 1 9.5 4 A6.5 6.5 0 0 0 20 14.5 Z" />
    </svg>
  )
}
