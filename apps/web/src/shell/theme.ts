import { createSignal } from 'solid-js'

export type ThemeName = 'dark' | 'light'

const STORAGE_KEY = 'agent-trace-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function stored(): ThemeName | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'dark' || value === 'light' ? value : undefined
  }
  catch {
    return undefined
  }
}

const [theme, setThemeSignal] = createSignal<ThemeName>('dark')
export { theme }

function apply(next: ThemeName): void {
  setThemeSignal(next)
  const root = document.documentElement
  root.dataset.theme = next
  // Kobalte reads `data-kb-theme`.
  root.dataset.kbTheme = next
  root.style.colorScheme = next
}

/** First load follows `prefers-color-scheme`; a manual choice in `localStorage` wins (S11). */
export function initTheme(): void {
  apply(stored() ?? (media().matches ? 'dark' : 'light'))
  media().addEventListener('change', (event) => {
    if (!stored())
      apply(event.matches ? 'dark' : 'light')
  })
}

export function chooseTheme(next: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, next)
  }
  catch {
    // Private mode: the choice lasts for this page only.
  }
  apply(next)
}
