import { render } from 'solid-js/web'
import { App } from './app.tsx'
import { applyLocale, preferredLocale } from './i18n/locale.ts'
import { bootLocation } from './shell/boot.ts'
import { reportTrace } from './shell/report.ts'
import { initTheme } from './shell/theme.ts'
import './styles.css'

initTheme()
const report = reportTrace()
// A report opens in the language it was exported in (plan 3.6); the switch still works.
applyLocale(report?.locale ?? preferredLocale())

const root = document.getElementById('app')
if (!root)
  throw new Error('#app mount node missing from index.html')

// A report has no server: no DevFrame connection, no one-time code, no route to rewrite.
void (report ? Promise.resolve() : bootLocation()).finally(() => {
  render(() => <App report={report} />, root)
})
