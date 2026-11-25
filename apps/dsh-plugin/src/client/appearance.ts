import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceContext } from './types.ts'

type EstelaTheme = 'light' | 'dark'
type EstelaLocale = 'en' | 'zh-CN'

export interface AppearanceTarget {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  readonly style?: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
}

interface HostTokenSpec {
  readonly estelaVar: string
  /** Ordered dsh CSS custom properties: active theme overrides are checked first, then CSS `var(...)` fallbacks. */
  readonly dshVars: readonly string[]
  readonly format?: (expr: string) => string
}

/**
 * Maps dsh's live `--dsw-*` / `--ds-*` design tokens onto `<estela-workspace>`'s `--estela-host-*` vars
 * without hardcoding any dsh palette hex values. When a variable is absent from dsh's stylesheet, CSS
 * treats the property as invalid at computed-value time and `:host` falls back to Estela's own palette.
 */
const HOST_TOKENS: readonly HostTokenSpec[] = [
  { estelaVar: '--estela-host-bg', dshVars: ['--dsw-alias-bg-base'] },
  { estelaVar: '--estela-host-secondary', dshVars: ['--dsw-specific-sidebar-fill', '--dsw-alias-bg-layer-1'] },
  {
    estelaVar: '--estela-host-muted',
    dshVars: ['--dsw-alias-card-fill-hover', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-layer-2'],
  },
  { estelaVar: '--estela-host-accent', dshVars: ['--dsw-alias-interactive-bg-hover'] },
  { estelaVar: '--estela-host-border', dshVars: ['--dsw-alias-border-l2', '--dsw-alias-border-l1'] },
  { estelaVar: '--estela-host-input', dshVars: ['--dsw-alias-border-l3', '--dsw-alias-border-l2'] },
  { estelaVar: '--estela-host-fg', dshVars: ['--dsw-alias-label-primary'] },
  { estelaVar: '--estela-host-muted-fg', dshVars: ['--dsw-alias-label-secondary'] },
  { estelaVar: '--estela-host-subtle-fg', dshVars: ['--dsw-alias-label-tertiary'] },
  { estelaVar: '--estela-host-destructive', dshVars: ['--dsw-alias-state-error-primary'] },
  { estelaVar: '--estela-host-link', dshVars: ['--dsw-alias-link'] },
  { estelaVar: '--estela-host-ring', dshVars: ['--dsw-alias-link'] },
  {
    estelaVar: '--estela-host-selection',
    dshVars: ['--dsw-alias-link'],
    format: expr => `color-mix(in srgb, ${expr} 10%, transparent)`,
  },
  {
    estelaVar: '--estela-host-selection-ring',
    dshVars: ['--dsw-alias-link'],
    format: expr => `color-mix(in srgb, ${expr} 45%, transparent)`,
  },
  { estelaVar: '--estela-host-font-sans', dshVars: ['--dsw-font-family'] },
  { estelaVar: '--estela-host-font-mono', dshVars: ['--ds-font-family-code'] },
  { estelaVar: '--estela-host-radius', dshVars: ['--dsw-radius-sm'] },
]

/** @internal Maps a dsh theme snapshot to Estela's `data-theme` attribute value. */
export function resolveEstelaTheme(snapshot: Pick<ThemeSnapshot, 'active'>): EstelaTheme {
  return snapshot.active.colorScheme === 'light' ? 'light' : 'dark'
}

/** @internal Maps a dsh locale snapshot to Estela's `lang` attribute value (`zh*` -> `zh-CN`, else `en`). */
export function resolveEstelaLocale(snapshot: Pick<LocaleSnapshot, 'active'>): EstelaLocale {
  return snapshot.active.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function nestedVar(names: readonly string[]): string {
  return names.reduceRight<string>((fallback, name) => (fallback ? `var(${name}, ${fallback})` : `var(${name})`), '')
}

/** @internal Resolves the CSS custom property map to apply onto `<estela-workspace>` for a dsh theme snapshot. */
export function resolveHostTokens(snapshot: Pick<ThemeSnapshot, 'active'>): Record<string, string> {
  const overrides = snapshot.active.tokens
  const resolved: Record<string, string> = {}
  for (const spec of HOST_TOKENS) {
    let expr: string | undefined
    for (const dshVar of spec.dshVars) {
      const value = overrides[dshVar]?.trim()
      if (value) {
        expr = value
        break
      }
    }
    const raw = expr ?? nestedVar(spec.dshVars)
    resolved[spec.estelaVar] = spec.format ? spec.format(raw) : raw
  }
  return resolved
}

function writeAttribute(target: AppearanceTarget, name: string, value: string): void {
  if (target.getAttribute(name) !== value) {
    target.setAttribute(name, value)
  }
}

function writeHostTokens(target: AppearanceTarget, snapshot: Pick<ThemeSnapshot, 'active'>): void {
  const style = target.style
  if (!style) {
    return
  }
  const tokens = resolveHostTokens(snapshot)
  for (const [name, value] of Object.entries(tokens)) {
    style.setProperty(name, value)
  }
}

function clearHostTokens(target: AppearanceTarget): void {
  const style = target.style
  if (!style) {
    return
  }
  for (const spec of HOST_TOKENS) {
    style.removeProperty(spec.estelaVar)
  }
}

/**
 * Syncs dsh's active theme, live design tokens, and locale onto the mounted `<estela-workspace>`
 * element and subscribes to live changes inside `ctx.effect`. Never writes `document.documentElement`.
 */
export function bindAppearance(ctx: AppearanceContext, target: AppearanceTarget): () => void {
  const syncTheme = (snapshot: ThemeSnapshot): void => {
    writeAttribute(target, 'data-theme', resolveEstelaTheme(snapshot))
    writeHostTokens(target, snapshot)
  }

  syncTheme(ctx.theme.getTheme())
  writeAttribute(target, 'lang', resolveEstelaLocale(ctx.locale.getLocale()))

  return ctx.effect(() => {
    const stopTheme = ctx.on('theme/change', syncTheme)
    const stopLocale = ctx.on('locale/change', snapshot => {
      writeAttribute(target, 'lang', resolveEstelaLocale(snapshot))
    })
    return () => {
      stopTheme()
      stopLocale()
      clearHostTokens(target)
    }
  }, 'estela: appearance')
}
