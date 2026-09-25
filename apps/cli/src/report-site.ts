import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The `<script type="application/json">` id the SPA looks for (`apps/web/src/shell/report.ts`). */
export const REPORT_ELEMENT_ID = 'report-trace'
const METHOD = 'agent-trace:report-trace'

interface DumpEntry {
  type?: string
  records?: Record<string, string>
  fallback?: string
}

/** The output DevFrame baked for `report-trace`: its fallback record, else its only record. */
async function bakedReport(outDir: string): Promise<unknown> {
  const manifest = JSON.parse(await readFile(join(outDir, '__rpc-dump/index.json'), 'utf8')) as Record<string, DumpEntry>
  const entry = manifest[METHOD]
  const path = entry?.fallback ?? Object.values(entry?.records ?? {})[0]
  if (!path)
    throw new Error(`the static dump has no ${METHOD} record`)
  const record = JSON.parse(await readFile(join(outDir, path), 'utf8')) as { output?: unknown, error?: { message?: string } }
  if (record.error)
    throw new Error(`${METHOD} failed while baking: ${record.error.message ?? 'unknown error'}`)
  return record.output
}

/**
 * Text that stays inside its `<script>` or `<style>` element: `</` and `<!--` are the only
 * sequences that end or change HTML's script data state. In JavaScript and CSS a backslash
 * before `/` or `!` means the same character.
 */
function scriptSafe(text: string): string {
  return text.replaceAll('</', '<\\/').replaceAll('<!--', '<\\!--')
}

/** The same for JSON, where both sequences can only sit inside strings: `\/` and `\u0021` are JSON escapes. */
function jsonSafe(value: unknown): string {
  return JSON.stringify(value).replaceAll('</', '<\\/').replaceAll('<!--', '<\\u0021--')
}

/** `woff2` fonts become data URIs; `woff` fallbacks are dropped (every supported browser reads `woff2`). */
async function inlineFonts(css: string, assets: string): Promise<string> {
  const withoutWoff = css.replaceAll(/,\s*url\(\.\/[^)]+\.woff\)\s*format\("woff"\)/g, '')
  const names = [...new Set([...withoutWoff.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)].map(match => match[1]!))]
  let out = withoutWoff
  for (const name of names) {
    const data = (await readFile(join(assets, name))).toString('base64')
    out = out.replaceAll(`url(./${name})`, `url(data:font/woff2;base64,${data})`)
  }
  return out
}

/**
 * Turns DevFrame's static build into a report that opens from `file://` (S9). Chromium refuses
 * `fetch()`, module scripts, and fonts from `file://`, so the page cannot read `__rpc-dump/`
 * or load `assets/`. The baked `report-trace` output moves into `index.html` as JSON, the
 * script and the styles are inlined (fonts as data URIs), and the fetch-only files are removed.
 */
export async function packForFile(outDir: string): Promise<void> {
  const report = await bakedReport(outDir)
  const indexPath = join(outDir, 'index.html')
  const assets = join(outDir, 'assets')
  let html = await readFile(indexPath, 'utf8')

  const script = /<script type="module" crossorigin src="\.\/assets\/([^"]+\.js)"><\/script>/.exec(html)
  const style = /<link rel="stylesheet" crossorigin href="\.\/assets\/([^"]+\.css)">/.exec(html)
  if (!script || !style)
    throw new Error('the web build has no module script or stylesheet in index.html')
  const code = await readFile(join(assets, script[1]!), 'utf8')
  const css = await inlineFonts(await readFile(join(assets, style[1]!), 'utf8'), assets)
  const data = `<script type="application/json" id="${REPORT_ELEMENT_ID}">${jsonSafe(report)}</script>`
  // Replacer functions: `$` in the inlined text must not be read as a replacement pattern.
  html = html
    .replace(style[0], () => `<style>${scriptSafe(css)}</style>`)
    .replace(script[0], () => `${data}\n    <script type="module">${scriptSafe(code)}</script>`)
  await writeFile(indexPath, html)

  for (const name of ['assets', '__rpc-dump', '__connection.json'])
    await rm(join(outDir, name), { recursive: true, force: true })
}
