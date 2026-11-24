import { createSignal } from 'solid-js'

/** `system` follows `prefers-color-scheme`; `light` and `dark` are a stored manual choice (S11). */
export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'estela-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function stored(): 'light' | 'dark' | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'dark' || value === 'light' ? value : undefined
  } catch {
    return undefined
  }
}

const [mode, setMode] = createSignal<ThemeMode>('system')
export { mode as themeMode }

function apply(): void {
  const choice = mode()
  const resolved = choice === 'system' ? (media().matches ? 'dark' : 'light') : choice
  document.documentElement.dataset.theme = resolved
}

export function initTheme(): void {
  setMode(stored() ?? 'system')
  apply()
  media().addEventListener('change', () => {
    if (mode() === 'system') {
      apply()
    }
  })
}

/** `system` clears the stored choice; `light` and `dark` persist it. */
export function chooseTheme(next: ThemeMode): void {
  try {
    if (next === 'system') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, next)
    }
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  setMode(next)
  apply()
}

/** The switch cycles system → light → dark → system. */
export function nextThemeMode(current: ThemeMode): ThemeMode {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
}
