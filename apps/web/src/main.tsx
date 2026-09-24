import { render } from 'solid-js/web'
import { App } from './app.tsx'
import './styles.css'

const mq = window.matchMedia('(prefers-color-scheme: dark)')
function applyScheme(dark: boolean): void {
  document.documentElement.dataset.kbTheme = dark ? 'dark' : 'light'
}
applyScheme(mq.matches)
mq.addEventListener('change', e => applyScheme(e.matches))

const root = document.getElementById('app')
if (!root)
  throw new Error('#app mount node missing from index.html')

render(() => <App />, root)
