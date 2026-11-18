import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const siteRoot = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(siteRoot, 'dist/client')

function normalizeBase(value) {
  const trimmed = value.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

const base = normalizeBase(process.env.ESTELA_SITE_BASE ?? '/estela/')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error('Chrome binary not found; set CHROME to the executable path')
}

function resolveStaticFile(pathname) {
  if (base !== '/' && !pathname.startsWith(base)) {
    return null
  }
  const rel = pathname.slice(base.length).replace(/\/+$/, '')
  const candidate = path.resolve(distDir, rel)
  if (!candidate.startsWith(distDir)) {
    return null
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate
  }
  const indexFile = path.join(candidate, 'index.html')
  if (existsSync(indexFile) && statSync(indexFile).isFile()) {
    return indexFile
  }
  return null
}

function startServer() {
  const requested = []
  const outOfBase = []
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    requested.push(pathname)
    if (base !== '/' && !pathname.startsWith(base)) {
      outOfBase.push(pathname)
      res.writeHead(404).end('outside base path')
      return
    }
    const file = resolveStaticFile(pathname)
    if (!file) {
      res.writeHead(404).end('not found')
      return
    }
    const ext = path.extname(file)
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        throw new Error('unexpected server address')
      }
      resolve({ server, origin: `http://127.0.0.1:${addr.port}`, requested, outOfBase })
    })
  })
}

async function launchChrome() {
  const chromePath = findChrome()
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'estela-site-check-'))
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--window-size=1280,800',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
  ]
  if (process.platform === 'linux') {
    args.push('--no-sandbox', '--disable-dev-shm-usage')
  }
  args.push('about:blank')
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = ''
    const timer = setTimeout(() => {
      reject(new Error(`timed out waiting for Chrome DevTools:\n${stderr}`))
    }, 15_000)
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`Chrome exited (${code}):\n${stderr}`))
    })
  })
  const baseUrl = wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '')
  const targets = await (await fetch(`${baseUrl}/json/list`)).json()
  const pageTarget = targets.find(t => t.type === 'page')
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error('missing page target from Chrome DevTools')
  }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return {
    ws,
    close: async () => {
      ws.close()
      child.kill('SIGTERM')
      await new Promise(resolve => {
        child.once('exit', resolve)
        setTimeout(resolve, 1500)
      })
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }
}

function createCdp(ws) {
  let seq = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message))
      } else {
        resolve(msg.result)
      }
      return
    }
    if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) {
        fn(msg.params)
      }
    }
  })
  return {
    send(method, params = {}) {
      const id = (seq += 1)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    on(method, fn) {
      const set = listeners.get(method) ?? new Set()
      set.add(fn)
      listeners.set(method, set)
    },
  }
}

async function waitFor(fn, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result) {
        return result
      }
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'Runtime.evaluate failed')
  }
  return res.result.value
}

async function click(cdp, selector) {
  await waitFor(
    () =>
      evaluate(
        cdp,
        `(() => {
          const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(
            n => n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden' && !n.closest('[aria-hidden="true"]'),
          );
          if (!el) return false;
          el.click();
          return true;
        })()`,
      ),
    `visible ${selector}`,
  )
}

async function main() {
  assert(existsSync(path.join(distDir, 'index.html')), 'dist/client/index.html missing; run build first')
  const { server, origin, requested, outOfBase } = await startServer()
  const chrome = await launchChrome()
  const errors = []
  const badResponses = []

  try {
    const cdp = createCdp(chrome.ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')

    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') {
        errors.push(`console.error: ${p.args.map(a => a.value ?? a.description ?? '').join(' ')}`)
      }
    })
    cdp.on('Runtime.exceptionThrown', p => {
      errors.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`)
    })
    cdp.on('Network.responseReceived', p => {
      if (p.response.url.startsWith(origin) && p.response.status >= 400) {
        badResponses.push(`${p.response.status} ${p.response.url}`)
      }
    })

    await cdp.send('Page.navigate', { url: `${origin}${base}` })
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.readyState === 'complete' && Boolean(document.querySelector('[data-lang="en"] h1')?.textContent)`,
        ),
      'landing',
    )
    assert(await evaluate(cdp, `document.title.trim().length > 0`), 'landing title is empty')

    // In-place language toggle persists on reload without changing URL path.
    await click(cdp, 'button[lang="zh-CN"]')
    await waitFor(
      () =>
        evaluate(
          cdp,
          `document.documentElement.lang === 'zh-CN' && getComputedStyle(document.querySelector('[data-lang="zh-CN"]')).visibility === 'visible'`,
        ),
      'zh-CN landing',
    )
    assert(
      await evaluate(
        cdp,
        `document.querySelector('[data-lang="en"]')?.getAttribute('aria-hidden') === 'true' && getComputedStyle(document.querySelector('[data-lang="en"]')).visibility === 'hidden'`,
      ),
      'English landing tree remained visible after switching to zh-CN',
    )
    assert((await evaluate(cdp, `location.pathname`)) === base, 'language switch altered landing URL path')
    await cdp.send('Page.reload')
    await waitFor(
      () => evaluate(cdp, `document.readyState === 'complete' && document.documentElement.lang === 'zh-CN'`),
      'persisted zh-CN after reload',
    )
    await click(cdp, 'button[lang="en"]')
    await waitFor(() => evaluate(cdp, `document.documentElement.lang === 'en'`), 'switch back to en')

    // Click into /docs, then navigate guide and reference pages by clicking sidebar links.
    await click(cdp, `header a[href="${base}docs"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname.startsWith(${JSON.stringify(`${base}docs`)}) && Boolean(document.querySelector('[data-docs] h1')?.textContent)`,
        ),
      '/docs page',
    )
    const docsTitle = await evaluate(cdp, `document.title`)
    assert(
      typeof docsTitle === 'string' && docsTitle.trim().length > 0 && docsTitle.endsWith(' · Estela'),
      `bad docs title: ${docsTitle}`,
    )
    const docsCanonical = await evaluate(cdp, `document.querySelector('link[rel="canonical"]')?.getAttribute('href')`)
    assert(
      docsCanonical === `https://perfectpan.github.io${base}docs/guide`,
      `unexpected /docs canonical: ${docsCanonical}`,
    )

    await click(cdp, `a[href="${base}docs/guide/getting-started"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/guide/getting-started`)} && Boolean(document.querySelector('[data-docs] h1')?.textContent)`,
        ),
      'getting-started docs page',
    )
    const guideTitle = await evaluate(cdp, `document.title`)
    assert(
      typeof guideTitle === 'string' && guideTitle.trim().length > 0 && guideTitle.endsWith(' · Estela'),
      `bad guide title: ${guideTitle}`,
    )

    await click(cdp, `a[href="${base}docs/reference/public-interface"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/reference/public-interface`)} && Boolean(document.querySelector('[data-docs] h1')?.textContent)`,
        ),
      'public-interface docs page',
    )
    assert(
      await evaluate(cdp, `Boolean(document.querySelector('a[href="${base}docs/architecture/overview"]'))`),
      'top-level architecture/overview link missing in sidebar',
    )

    // In-place language toggle on a docs page keeps the same URL and shows the Chinese fallback on design/.
    await click(cdp, 'button[lang="zh-CN"]')
    await waitFor(() => evaluate(cdp, `document.documentElement.lang === 'zh-CN'`), 'docs zh-CN switch')
    assert(
      (await evaluate(cdp, `location.pathname`)) === `${base}docs/reference/public-interface`,
      'docs language switch changed pathname',
    )
    await click(cdp, `a[href="${base}docs/design"]`)
    await waitFor(
      () =>
        evaluate(
          cdp,
          `location.pathname === ${JSON.stringify(`${base}docs/design`)} && document.body.textContent.includes('此页尚无中文译本')`,
        ),
      'design fallback notice in zh-CN',
    )
    assert(
      await evaluate(
        cdp,
        `[...document.querySelectorAll('[data-docs] img')].every(img => img.complete && img.naturalWidth > 0)`,
      ),
      'design page image failed to load',
    )

    // Both static search indexes must exist under the site base path.
    for (const lang of ['en', 'zh-CN']) {
      const status = await evaluate(
        cdp,
        `fetch(${JSON.stringify(`${base}api/search.${lang}.json`)}).then(r => r.status)`,
      )
      assert(status === 200, `search.${lang}.json returned ${status}`)
    }

    // Live demo loads cleanly without errors.
    await cdp.send('Page.navigate', { url: `${origin}${base}demo/` })
    await waitFor(() => evaluate(cdp, `Boolean(document.querySelector('#report-trace'))`), 'demo report trace script')

    assert(outOfBase.length === 0, `requests left base path ${base}: ${outOfBase.join(', ')}`)
    assert(!requested.some(p => /\/zh(?:\/|$)/.test(p)), `unexpected /zh request: ${requested.join(', ')}`)
    assert(badResponses.length === 0, `HTTP errors: ${badResponses.join(', ')}`)
    assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`)
    console.log(`check-site passed (${requested.length} static requests under ${base})`)
  } finally {
    await chrome.close()
    server.close()
  }
}

await main()
