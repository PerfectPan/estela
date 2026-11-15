import { createHash } from 'node:crypto'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NAMESPACE } from '@rivus/estela-rpc'
import * as z from 'zod/mini'

/** The `<script type="application/json">` id the SPA looks for (`apps/web/src/shell/report.ts`). */
const REPORT_ELEMENT_ID = 'report-trace'
const METHOD = `${NAMESPACE}:report-trace`

/** What is read of DevFrame's `__rpc-dump/index.json`: the query entry of `report-trace`, if there is one. */
const dumpManifest = z.object({
  [METHOD]: z.optional(
    z.object({ records: z.optional(z.record(z.string(), z.string())), fallback: z.optional(z.string()) }),
  ),
})
/** One baked call: the error the handler threw, or its output (any JSON value), embedded in the report as it is. */
const dumpRecord = z.union([
  z.object({ error: z.object({ message: z.optional(z.string()) }) }),
  z.object({ output: z.nonoptional(z.unknown()) }),
])

/** The output DevFrame baked for `report-trace`: its fallback record, else its only record. */
async function bakedReport(outDir: string): Promise<unknown> {
  const manifest = z.safeParse(dumpManifest, JSON.parse(await readFile(join(outDir, '__rpc-dump/index.json'), 'utf8')))
  const entry = manifest.data?.[METHOD]
  const path = entry?.fallback ?? Object.values(entry?.records ?? {})[0]
  if (!path) {
    throw new Error(`the static dump has no ${METHOD} record`)
  }
  const record = z.safeParse(dumpRecord, JSON.parse(await readFile(join(outDir, path), 'utf8')))
  if (!record.success) {
    throw new Error(`the static dump's ${METHOD} record is not an output or an error`)
  }
  // Known-union narrowing: the parsed record is one of the two members above.
  if ('error' in record.data) {
    throw new Error(`${METHOD} failed while baking: ${record.data.error.message ?? 'unknown error'}`)
  }
  return record.data.output
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
  if (!script || !style) {
    throw new Error('the web build has no module script or stylesheet in index.html')
  }
  // Only the entry is inlined; any other script would be dropped and fail to load from disk.
  const extra = (await readdir(assets)).filter(name => name.endsWith('.js') && name !== script[1])
  if (extra.length > 0) {
    throw new Error(`the web build has scripts besides its entry (${extra.join(', ')}); build it as one chunk`)
  }
  const code = await readFile(join(assets, script[1]!), 'utf8')
  const css = await inlineFonts(await readFile(join(assets, style[1]!), 'utf8'), assets)
  const inlinedScript = scriptSafe(code)
  const scriptHash = createHash('sha256').update(inlinedScript, 'utf8').digest('base64')
  const reportCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />`
  const data = `<script type="application/json" id="${REPORT_ELEMENT_ID}">${jsonSafe(report)}</script>`
  // Replacer functions: `$` in the inlined text must not be read as a replacement pattern.
  html = html
    .replace(/<base\b[^>]*>\s*/i, '')
    .replace(style[0], () => `<style>${scriptSafe(css)}</style>`)
    .replace(script[0], () => `${data}\n    <script type="module">${inlinedScript}</script>`)
  const cspMeta = /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i
  if (cspMeta.test(html)) {
    html = html.replace(cspMeta, () => reportCsp)
  } else if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, match => `${match}\n    ${reportCsp}`)
  } else {
    html = `${reportCsp}\n${html}`
  }
  await writeFile(indexPath, html)

  for (const name of ['assets', '__rpc-dump', '__connection.json']) {
    await rm(join(outDir, name), { recursive: true, force: true })
  }
}
