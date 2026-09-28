import { render } from 'solid-js/web'
import { App } from './app.tsx'
import { applyLocale } from './i18n/locale.ts'
import { bootLocation } from './shell/boot.ts'
import { initTheme } from './shell/theme.ts'
import './styles.css'

initTheme()
applyLocale()

const root = document.getElementById('app')
if (!root)
  throw new Error('#app mount node missing from index.html')

void bootLocation().finally(() => {
  render(() => <App />, root)
})
