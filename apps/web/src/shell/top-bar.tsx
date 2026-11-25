import type { MessageKey } from '@/i18n/locale.ts'
import type { ThemeMode } from '@/shell/theme.ts'
import type { JSX } from 'solid-js'
import { For, Match, Show, Switch } from 'solid-js'
import { chooseLocale, locale, translate as t } from '@/i18n/locale.ts'
import { chooseTheme, nextThemeMode, themeMode } from '@/shell/theme.ts'
import { Logo } from '@/shell/logo.tsx'
import { SearchIcon, SystemIcon, SunIcon, MoonIcon } from '@/components/icons.tsx'

const THEME_LABEL: Record<ThemeMode, MessageKey> = {
  system: 'common.themeSystem',
  light: 'common.themeLight',
  dark: 'common.themeDark',
}

const themeLabel = () =>
  t('common.themeSwitch', {
    mode: t(THEME_LABEL[themeMode()]),
    next: t(THEME_LABEL[nextThemeMode(themeMode())]),
  })

/**
 * The shared 52 px top bar of both screens: logo, breadcrumbs, the ⌘K button, the
 * theme and language switches, and screen actions (the workspace's "Export report").
 * The ⌘K button is a plain button whose label names what it focuses: the event ledger, or the
 * session list's search box, the one screen where it also carries a search icon.
 */
export function TopBar(props: {
  crumbs?: string[]
  onJump?: () => void
  /** The label of the ⌘K button; `common.goToEvents` unless set. */
  jumpLabel?: MessageKey
  /** Draws the search icon in front of the label, for a screen whose ⌘K button focuses a search box. */
  searchIcon?: boolean
  actions?: JSX.Element
  report?: boolean
  embedded?: boolean
}) {
  const crumbs = () => props.crumbs ?? []
  return (
    <header class="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-5">
      <div class="flex min-w-0 items-center gap-3.5">
        <Show
          when={!props.embedded}
          fallback={
            <span class="flex shrink-0 items-center gap-2.5 text-foreground">
              <Logo />
              <span class="text-[15px] font-semibold tracking-[-0.01em]">{t('common.appName')}</span>
            </span>
          }
        >
          <a href="#/" class="flex shrink-0 items-center gap-2.5 text-foreground">
            <Logo />
            <span class="text-[15px] font-semibold tracking-[-0.01em]">{t('common.appName')}</span>
          </a>
        </Show>
        <nav class="flex min-w-0 items-center gap-2.5 text-[13px]">
          <span class="text-subtle">/</span>
          {/* A report or embedded workspace has no session list to go back to. */}
          <Switch
            fallback={
              <a
                href="#/"
                class={crumbs().length > 0 ? 'text-muted-foreground hover:text-foreground' : 'text-foreground'}
              >
                {t('common.sessions')}
              </a>
            }
          >
            <Match when={props.report}>
              <span class="text-muted-foreground">{t('report.title')}</span>
            </Match>
            <Match when={props.embedded}>
              <span class={crumbs().length > 0 ? 'text-muted-foreground' : 'text-foreground'}>
                {t('common.session')}
              </span>
            </Match>
          </Switch>
          <For each={crumbs()}>
            {(crumb, index) => (
              <>
                <span class="text-subtle">/</span>
                <span
                  class={`truncate ${index() === crumbs().length - 1 ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {crumb}
                </span>
              </>
            )}
          </For>
        </nav>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          class="flex h-8 items-center gap-2 rounded-lg border border-input px-2.5 text-[13px] whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => props.onJump?.()}
        >
          <Show when={props.searchIcon}>
            <SearchIcon />
          </Show>
          <span>{t(props.jumpLabel ?? 'common.goToEvents')}</span>
          <kbd
            aria-hidden="true"
            class="rounded border border-input px-[5px] py-px font-mono text-[11px] leading-none text-subtle"
          >
            ⌘K
          </kbd>
        </button>
        <Show when={!props.embedded}>
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
              <Match when={themeMode() === 'system'}>
                <SystemIcon />
              </Match>
              <Match when={themeMode() === 'light'}>
                <SunIcon />
              </Match>
              <Match when={themeMode() === 'dark'}>
                <MoonIcon />
              </Match>
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
        </Show>
        {props.actions}
      </div>
    </header>
  )
}
