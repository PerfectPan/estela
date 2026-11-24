import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { ctx } from './harness.ts'

const exec = promisify(execFile)

export type EmbedSourceMode = 'ready' | 'slow' | 'throw' | 'fail-once' | 'event-fail'

interface EmbedPageControl {
  openCalls: () => number
  eventCalls: () => number
  resolveOpen: () => void
  isSameElement: () => boolean
  isSameSource: () => boolean
  setTheme: (theme: 'dark' | 'light') => void
  setLang: (lang: string) => void
  disconnect: () => void
}

declare global {
  interface Window {
    __embed?: EmbedPageControl
  }
}

export interface EmbedHostServer {
  url: (pathAndQuery: string) => string
  close: () => Promise<void>
}

const reportCache = new Map<string, Promise<string>>()
let embedBundleCache: Promise<string> | undefined

/** Builds a static report through the installed CLI and extracts its `report-trace` JSON payload. */
export function loadFixtureReportJson(sessionPath: string, slug: string): Promise<string> {
  const existing = reportCache.get(sessionPath)
  if (existing) {
    return existing
  }
  const pending = (async () => {
    const dir = join(ctx.root, `embed-fixture-${slug}`)
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: ctx.homes.main.home }
    for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME']) {
      delete env[name]
    }
    try {
      await exec(process.execPath, [ctx.bin, 'build', sessionPath, '--out-dir', dir], { env })
      const html = await readFile(join(dir, 'index.html'), 'utf8')
      const match = /<script\b[^>]*id="report-trace"[^>]*>([\s\S]*?)<\/script>/.exec(html)
      if (!match?.[1]) {
        throw new Error(`report-trace script missing from ${dir}/index.html`)
      }
      return match[1]
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })()
  reportCache.set(sessionPath, pending)
  return pending
}

function loadEmbedBundle(): Promise<string> {
  if (!embedBundleCache) {
    embedBundleCache = readFile(join(ctx.repo, 'apps/web/dist-embed/index.js'), 'utf8')
  }
  return embedBundleCache
}

/**
 * Host page HTML that deliberately sets foreign `<html lang="fr" data-theme="host-page">`,
 * conflicting `:root` CSS tokens, inherited `body` text rules, and sibling host chrome around
 * `<estela-workspace>` so isolation, styling, and error containment are tested in real Chrome.
 */
const HOST_HTML = `<!DOCTYPE html>
<html lang="fr" data-theme="host-page">
  <head>
    <meta charset="UTF-8" />
    <title>Embed host harness</title>
    <style>
      :root {
        --background: #ffe0f0;
        --foreground: #1a0033;
        --muted: #eeeeee;
        --border: #ff00ff;
        --ring: #00ffff;
        --radius: 24px;
        --font-sans: "Georgia", serif;
        --font-mono: "Courier New", monospace;
        --color-background: #ffe0f0;
        --color-foreground: #1a0033;
        --kind-request: #ff0000;
      }
      html, body {
        height: 100%;
        margin: 0;
      }
      body {
        display: flex;
        flex-direction: column;
        background: #ffe0f0;
        white-space: pre-wrap;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #ff00ff;
        font-style: italic;
      }
      #host-chrome {
        flex: 0 0 auto;
        padding: 4px 12px;
        font: 12px/1.4 sans-serif;
        color: #111;
        background: #f5f5f5;
        border-bottom: 1px solid #ccc;
        text-transform: none;
        font-style: normal;
        letter-spacing: normal;
      }
      #host-stage {
        flex: 1 1 auto;
        min-height: 0;
      }
    </style>
  </head>
  <body>
    <header id="host-chrome" data-testid="host-chrome">Host page chrome</header>
    <div id="host-stage"><estela-workspace id="ws"></estela-workspace></div>
    <script type="module">
      import { defineEstelaWorkspace } from '/embed.js'

      defineEstelaWorkspace()
      const params = new URLSearchParams(location.search)
      const mode = params.get('mode') || 'ready'
      const theme = params.get('theme') || 'dark'
      const lang = params.get('lang') || 'en'

      const report = await (await fetch('/fixture.json')).json()
      const fullEvents = new Map(report.events.map(item => [item.id, item]))
      const viewEvents = new Map(report.trace.events.map(item => [item.id, item]))

      const el = document.getElementById('ws')
      el.setAttribute('data-theme', theme)
      el.setAttribute('lang', lang)

      let openCalls = 0
      let eventCalls = 0
      let pendingResolve = null

      const viewFor = call => ({
        traceId: 'embed-trace-' + call,
        trace: report.trace,
        summary: report.summary,
        bytes: 1024,
      })

      const source = {
        open() {
          openCalls += 1
          const call = openCalls
          if (mode === 'throw') {
            throw new Error('channel exploded')
          }
          if (mode === 'fail-once' && call === 1) {
            return Promise.reject(new Error('temporary open failure'))
          }
          if (mode === 'slow' && call === 1) {
            return new Promise(resolve => {
              pendingResolve = () => resolve(viewFor(call))
            })
          }
          return Promise.resolve(viewFor(call))
        },
        async event(_traceId, id) {
          eventCalls += 1
          if (mode === 'event-fail' && openCalls === 1) {
            throw new Error('transport closed')
          }
          const full = fullEvents.get(id)
          if (full) {
            return full
          }
          const shown = viewEvents.get(id)
          if (!shown) {
            throw new Error('unknown event ' + id)
          }
          return { ...shown, originalUnavailable: 'not in fixture' }
        },
      }

      window.__embed = {
        openCalls: () => openCalls,
        eventCalls: () => eventCalls,
        resolveOpen: () => {
          if (pendingResolve) {
            const run = pendingResolve
            pendingResolve = null
            run()
          }
        },
        isSameElement: () => document.getElementById('ws') === el,
        isSameSource: () => document.getElementById('ws')?.source === source,
        setTheme: next => el.setAttribute('data-theme', next),
        setLang: next => el.setAttribute('lang', next),
        disconnect: () => el.remove(),
      }

      el.source = source
    </script>
  </body>
</html>
`

/** Starts a loopback HTTP server hosting the embed harness page, `/embed.js`, and `/fixture.json`. */
export async function startEmbedHost(reportJson: string): Promise<EmbedHostServer> {
  const embedJs = await loadEmbedBundle()
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/embed.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(embedJs)
      return
    }
    if (pathname === '/fixture.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(reportJson)
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(HOST_HTML)
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('failed to bind loopback port for embed harness')
  }
  const base = `http://127.0.0.1:${address.port}`
  return {
    url: pathAndQuery => `${base}${pathAndQuery}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()))
      }),
  }
}
