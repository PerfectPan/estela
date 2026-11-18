import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

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

function resolveStaticFile(distDir, base, pathname) {
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

/** Serves `distDir` strictly under `base` with no SPA fallback and records out-of-base requests. */
export function startStaticServer(distDir, base) {
  const requested = []
  const outOfBase = []
  let maxJsDelayMs = 0
  let minJsDelayMs = 0
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    requested.push(pathname)
    if (base !== '/' && !pathname.startsWith(base)) {
      outOfBase.push(pathname)
      res.writeHead(404).end('outside base path')
      return
    }
    const file = resolveStaticFile(distDir, base, pathname)
    if (!file) {
      res.writeHead(404).end('not found')
      return
    }
    const ext = path.extname(file)
    if (ext === '.js' && maxJsDelayMs > 0) {
      const span = Math.max(0, maxJsDelayMs - minJsDelayMs)
      await new Promise(resolve => setTimeout(resolve, minJsDelayMs + Math.floor(Math.random() * span)))
    }
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        throw new Error('unexpected server address')
      }
      resolve({
        server,
        origin: `http://127.0.0.1:${addr.port}`,
        requested,
        outOfBase,
        setJsDelayMs(maxMs, minMs = 0) {
          maxJsDelayMs = maxMs
          minJsDelayMs = minMs
        },
      })
    })
  })
}

function openWebSocket(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out opening CDP WebSocket')), 15_000)
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve(ws)
      },
      { once: true },
    )
    ws.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('failed to open CDP WebSocket'))
      },
      { once: true },
    )
  })
}

async function stopChrome(child, userDataDir, ...sockets) {
  for (const sock of sockets) {
    try {
      sock?.close()
    } catch {
      // Ignore close errors during teardown.
    }
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Process may have exited right as the grace timer fired.
        }
        resolve()
      }, 1500)
      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
    })
  }
  rmSync(userDataDir, { recursive: true, force: true })
}

/** CDP client over an open WebSocket with per-call timeouts and close/error rejection. */
export function createCdp(ws) {
  let seq = 0
  const pending = new Map()
  const listeners = new Map()
  const rejectAll = message => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(message))
    }
    pending.clear()
  }
  ws.addEventListener('close', () => rejectAll('CDP WebSocket closed'))
  ws.addEventListener('error', () => rejectAll('CDP WebSocket errored'))
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      const entry = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) {
        entry.reject(new Error(msg.error.message))
      } else {
        entry.resolve(msg.result)
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
    send(method, params = {}, timeoutMs = 15_000) {
      if (ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`CDP WebSocket not open for ${method}`))
      }
      const id = (seq += 1)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`CDP call timed out (${timeoutMs}ms): ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
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

/** Launches headless Chrome with a temporary user profile and cleans up on failure or `close()`. */
export async function launchChrome() {
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
  let ws
  let browserWs
  try {
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
      child.once('exit', code => {
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
    ws = await openWebSocket(pageTarget.webSocketDebuggerUrl)
    browserWs = await openWebSocket(wsUrl)
    const browserCdp = createCdp(browserWs)
    const wsBase = baseUrl.replace(/^http/, 'ws')
    const openIsolatedPage = async () => {
      const { browserContextId } = await browserCdp.send('Target.createBrowserContext')
      try {
        const { targetId } = await browserCdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
        const pageWs = await openWebSocket(`${wsBase}/devtools/page/${targetId}`)
        return {
          cdp: createCdp(pageWs),
          async close() {
            try {
              pageWs.close()
            } catch {
              // Ignore close errors during teardown.
            }
            await browserCdp.send('Target.disposeBrowserContext', { browserContextId })
          },
        }
      } catch (error) {
        await browserCdp.send('Target.disposeBrowserContext', { browserContextId })
        throw error
      }
    }
    return { ws, openIsolatedPage, close: () => stopChrome(child, userDataDir, ws, browserWs) }
  } catch (error) {
    await stopChrome(child, userDataDir, ws, browserWs)
    throw error
  }
}

export async function waitFor(fn, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now())
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('attempt timed out')), remaining)),
      ])
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

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

export async function evaluate(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? 'Runtime.evaluate failed')
  }
  return res.result.value
}

export async function click(cdp, selector) {
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
