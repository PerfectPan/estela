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
 * The shared 52 px top bar of both screens: logo, breadcrumbs, the jump box, the
 * theme and language switches, and screen actions (the workspace's "Export report").
 */
export function TopBar(props: { crumbs?: string[]; onJump?: () => void; actions?: JSX.Element; report?: boolean }) {
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
          {/* A report has no session list to go back to. */}
          <Show when={!props.report} fallback={<span class="text-muted-foreground">{t('report.title')}</span>}>
            <a
              href="#/"
              class={crumbs().length > 0 ? 'text-muted-foreground hover:text-foreground' : 'text-foreground'}
            >
              {t('common.sessions')}
            </a>
          </Show>
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
        {props.actions}
      </div>
    </header>
  )
}
