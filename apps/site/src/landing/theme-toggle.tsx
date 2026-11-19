import { useSyncExternalStore } from 'react'
import { useTheme } from 'fumadocs-ui/provider/base'
import type { Dictionary } from '@/i18n/dictionary.en.ts'
import { MoonIcon, SunIcon } from '@/components/icons.tsx'
import { Button } from '@/components/ui/button.tsx'

const noop = () => () => {}

export function ThemeToggle({ t }: { t: Dictionary }) {
  const { resolvedTheme, setTheme } = useTheme()
  // The server cannot know the stored or system theme, so hold the theme-dependent icon until after hydration.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  const isDark = mounted && resolvedTheme === 'dark'
  const label = isDark ? t.nav.themeToLight : t.nav.themeToDark
  const toggle = () => setTheme(isDark ? 'light' : 'dark')

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label}>
      {isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
