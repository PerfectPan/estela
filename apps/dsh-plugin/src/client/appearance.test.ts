import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  bindAppearance,
  resolveEstelaLocale,
  resolveEstelaTheme,
  resolveHostTokens,
  type AppearanceTarget,
} from './appearance.ts'
import type { AppearanceContext } from './types.ts'

function themeSnapshot(colorScheme: 'light' | 'dark', tokens: Record<string, string> = {}): ThemeSnapshot {
  return {
    preference: colorScheme,
    fontSizes: { text: 14, code: 11, terminal: 13 },
    fontFamilies: { text: '', code: '', terminal: '' },
    active: { id: colorScheme, colorScheme, tokens },
    themes: [],
    revision: 0,
  }
}

function localeSnapshot(active: string): LocaleSnapshot {
  return {
    active,
    locales: [],
    revision: 0,
  }
}

function createTarget() {
  const attrs = new Map<string, string>()
  const styles = new Map<string, string>()
  const writes: Array<{ name: string; value: string }> = []
  const target: AppearanceTarget = {
    getAttribute(name) {
      return attrs.get(name) ?? null
    },
    setAttribute(name, value) {
      attrs.set(name, value)
      writes.push({ name, value })
    },
    style: {
      setProperty(name, value) {
        if (value === null) {
          styles.delete(name)
        } else {
          styles.set(name, value)
        }
      },
      removeProperty(name) {
        const previous = styles.get(name) ?? ''
        styles.delete(name)
        return previous
      },
    },
  }
  return { target, attrs, styles, writes }
}

function createFakeContext(initialScheme: 'light' | 'dark', initialLocale: string) {
  let currentTheme = themeSnapshot(initialScheme)
  let currentLocale = localeSnapshot(initialLocale)
  const themeListeners = new Set<(snapshot: ThemeSnapshot) => void>()
  const localeListeners = new Set<(snapshot: LocaleSnapshot) => void>()
  const cleanups = new Set<() => void>()

  const ctx: AppearanceContext = {
    theme: {
      getTheme: () => currentTheme,
    },
    locale: {
      getLocale: () => currentLocale,
    },
    on(
      event: 'theme/change' | 'locale/change',
      listener: ((s: ThemeSnapshot) => void) | ((s: LocaleSnapshot) => void),
    ) {
      if (event === 'theme/change') {
        const fn = listener as (s: ThemeSnapshot) => void
        themeListeners.add(fn)
        return () => {
          themeListeners.delete(fn)
        }
      }
      const fn = listener as (s: LocaleSnapshot) => void
      localeListeners.add(fn)
      return () => {
        localeListeners.delete(fn)
      }
    },
    effect(callback) {
      const cleanup = callback()
      const dispose = () => {
        cleanups.delete(dispose)
        cleanup?.()
      }
      cleanups.add(dispose)
      return dispose
    },
  }

  return {
    ctx,
    emitTheme: (colorScheme: 'light' | 'dark', tokens: Record<string, string> = {}) => {
      currentTheme = themeSnapshot(colorScheme, tokens)
      for (const listener of themeListeners) {
        listener(currentTheme)
      }
    },
    emitLocale: (active: string) => {
      currentLocale = localeSnapshot(active)
      for (const listener of localeListeners) {
        listener(currentLocale)
      }
    },
    disposeAll: () => {
      for (const dispose of Array.from(cleanups)) {
        dispose()
      }
    },
    listenerCounts: () => ({ theme: themeListeners.size, locale: localeListeners.size }),
  }
}

describe('appearance', () => {
  it('maps dsh theme and locale snapshots to Estela attributes', () => {
    expect(resolveEstelaTheme(themeSnapshot('light'))).toBe('light')
    expect(resolveEstelaTheme(themeSnapshot('dark'))).toBe('dark')
    expect(resolveEstelaLocale(localeSnapshot('zh'))).toBe('zh-CN')
    expect(resolveEstelaLocale(localeSnapshot('zh-CN'))).toBe('zh-CN')
    expect(resolveEstelaLocale(localeSnapshot('ZH-Hans'))).toBe('zh-CN')
    expect(resolveEstelaLocale(localeSnapshot('en'))).toBe('en')
    expect(resolveEstelaLocale(localeSnapshot('ja'))).toBe('en')
  })

  it('syncs initial attributes and follows live theme and locale changes', () => {
    const { ctx, emitTheme, emitLocale } = createFakeContext('light', 'en')
    const { target, attrs } = createTarget()

    const dispose = bindAppearance(ctx, target)
    expect(attrs.get('data-theme')).toBe('light')
    expect(attrs.get('lang')).toBe('en')

    emitTheme('dark')
    expect(attrs.get('data-theme')).toBe('dark')

    emitLocale('zh')
    expect(attrs.get('lang')).toBe('zh-CN')

    emitLocale('ja')
    expect(attrs.get('lang')).toBe('en')

    dispose()
  })

  it('never touches document.documentElement on initial sync or live updates', () => {
    const rootWrites: string[] = []
    const fakeDoc = {
      documentElement: {
        setAttribute(name: string) {
          rootWrites.push(`setAttribute:${name}`)
        },
        set lang(value: string) {
          rootWrites.push(`lang:${value}`)
        },
        dataset: new Proxy<Record<string, string>>(
          {},
          {
            set(_obj, key) {
              rootWrites.push(`dataset:${String(key)}`)
              return true
            },
          },
        ),
      },
    }
    vi.stubGlobal('document', fakeDoc)
    try {
      const { ctx, emitTheme, emitLocale } = createFakeContext('dark', 'zh')
      const { target } = createTarget()
      const dispose = bindAppearance(ctx, target)
      emitTheme('light')
      emitLocale('en')
      dispose()
    } finally {
      vi.unstubAllGlobals()
    }

    expect(rootWrites).toEqual([])
  })

  it('stops reacting to theme and locale events after dispose', () => {
    const { ctx, emitTheme, emitLocale, listenerCounts } = createFakeContext('light', 'en')
    const { target, attrs, writes } = createTarget()

    const dispose = bindAppearance(ctx, target)
    expect(listenerCounts()).toEqual({ theme: 1, locale: 1 })
    const writesBeforeDispose = writes.length

    dispose()
    expect(listenerCounts()).toEqual({ theme: 0, locale: 0 })

    emitTheme('dark')
    emitLocale('zh')
    expect(attrs.get('data-theme')).toBe('light')
    expect(attrs.get('lang')).toBe('en')
    expect(writes.length).toBe(writesBeforeDispose)
  })

  it('maps dsh theme tokens onto --estela-host-* vars, prefers active overrides, and cleans up on dispose', () => {
    const base = resolveHostTokens(themeSnapshot('light'))
    expect(base['--estela-host-bg']).toBe('var(--dsw-alias-bg-base)')
    expect(base['--estela-host-secondary']).toBe('var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1))')
    expect(base['--estela-host-fg']).toBe('var(--dsw-alias-label-primary)')
    expect(base['--estela-host-font-sans']).toBe('var(--dsw-font-family)')
    expect(base['--estela-host-font-mono']).toBe('var(--ds-font-family-code)')
    expect(base['--estela-host-radius']).toBe('var(--dsw-radius-sm)')
    expect(Object.values(base).some(v => /#[0-9a-f]{3,8}\b/i.test(v))).toBe(false)

    const { ctx, emitTheme } = createFakeContext('light', 'en')
    const { target, styles } = createTarget()
    const dispose = bindAppearance(ctx, target)
    expect(styles.get('--estela-host-bg')).toBe('var(--dsw-alias-bg-base)')
    expect(styles.get('--estela-host-link')).toBe('var(--dsw-alias-link)')

    emitTheme('dark', { '--dsw-alias-bg-base': 'rgb(10, 20, 30)', '--dsw-alias-link': 'rgb(100, 150, 255)' })
    expect(styles.get('--estela-host-bg')).toBe('rgb(10, 20, 30)')
    expect(styles.get('--estela-host-link')).toBe('rgb(100, 150, 255)')
    expect(styles.get('--estela-host-selection')).toBe('color-mix(in srgb, rgb(100, 150, 255) 10%, transparent)')

    dispose()
    expect(styles.size).toBe(0)
  })

  it('also unsubscribes when the owning context disposes all effects', () => {
    const { ctx, emitTheme, emitLocale, disposeAll, listenerCounts } = createFakeContext('dark', 'zh')
    const { target, attrs } = createTarget()

    bindAppearance(ctx, target)
    expect(listenerCounts()).toEqual({ theme: 1, locale: 1 })

    disposeAll()
    expect(listenerCounts()).toEqual({ theme: 0, locale: 0 })

    emitTheme('light')
    emitLocale('en')
    expect(attrs.get('data-theme')).toBe('dark')
    expect(attrs.get('lang')).toBe('zh-CN')
  })
})
