// Starts the built CLI's dev server as a user would and talks to it through DevFrame's own client,
// the one the SPA uses, so a measured time covers process start, the server, and the RPC round trip.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const READY = /Ready: (\S+)/
const SETTLE_MS = 300
const RSS_LINE = /^estela-max-rss-kb (\d+)$/m
/**
 * Preloaded into the CLI: on SIGTERM it prints the process's peak RSS (`maxRSS` is in KiB on every
 * platform) and exits, because a parent cannot read a child's rusage through `child_process`.
 */
const RSS_PRELOAD = `data:text/javascript,${encodeURIComponent(
  "import { writeSync } from 'node:fs'; process.once('SIGTERM', () => { writeSync(2, '\\nestela-max-rss-kb ' + process.resourceUsage().maxRSS + '\\n'); process.exit(0) })",
)}`

let clientModule
async function devframeClient(root) {
  if (!clientModule) {
    // The SPA's client expects a page: `location` for the WebSocket URL, and Node 26's `localStorage`
    // getter warns when no storage file is set, so it is shadowed with nothing.
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    const require = createRequire(join(root, 'apps/cli/package.json'))
    clientModule = await import(pathToFileURL(require.resolve('devframe/client')).href)
  }
  return clientModule
}

/**
 * Spawns `node apps/cli/dist/bin.mjs <args> --no-auth --no-open --port 0` with `env`, and resolves
 * once it prints its Ready URL. `startedAt` is `performance.now()` just before the spawn.
 */
export async function startServer(root, args, env, timeoutMs) {
  const startedAt = performance.now()
  const child = spawn(
    process.execPath,
    ['--import', RSS_PRELOAD, join(root, 'apps/cli/dist/bin.mjs'), ...args, '--no-auth', '--no-open', '--port', '0'],
    { cwd: root, env: { ...process.env, NO_COLOR: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
  const closed = new Promise(resolve => child.once('close', resolve))
  const url = await new Promise((resolve, reject) => {
    const done = { timer: undefined, listeners: [] }
    const settle = () => {
      clearTimeout(done.timer)
      for (const [emitter, event, listener] of done.listeners) {
        emitter.off(event, listener)
      }
    }
    const fail = message => {
      settle()
      child.kill('SIGKILL')
      reject(new Error(`${message}\n--- stdout\n${stdout}\n--- stderr\n${stderr}`))
    }
    const onData = () => {
      const match = READY.exec(stdout)
      if (match) {
        settle()
        resolve(match[1])
      }
    }
    const onExit = code => fail(`the CLI exited with ${code} before Ready`)
    done.listeners.push([child.stdout, 'data', onData], [child, 'exit', onExit])
    child.stdout.on('data', onData)
    child.once('exit', onExit)
    done.timer = setTimeout(() => fail(`no Ready line within ${timeoutMs} ms`), timeoutMs)
  })
  const readyMs = performance.now() - startedAt
  const base = url.replace(/#.*$/, '')
  const { getDevframeRpcClient } = await devframeClient(root)
  globalThis.location = new URL(base)
  // The client keeps one connection per page in these globals; each server here is a new page.
  for (const key of ['__DEVFRAME_CONNECTION__', '__DEVFRAME_CONNECTION_META__', '__DEVFRAME_CONNECTION_AUTH_TOKEN__']) {
    delete globalThis[key]
  }
  const client = await getDevframeRpcClient({ baseURL: base, webmcp: false })
  return {
    startedAt,
    readyMs,
    /** The trace id in the Ready URL, when the CLI was given a session. */
    traceId: /#\/s\/(.+)$/.exec(url)?.[1],
    call: (name, input) => client.call(`estela:${name}`, input),
    output: () => ({ stdout, stderr }),
    /** Stops the server and returns its peak RSS in bytes. */
    async stop() {
      // The client reads DevFrame's shared state after connecting; a socket closed before that answer
      // arrives makes it log a disconnect error. Nothing is measured after this point.
      await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
      client.close()
      child.kill('SIGTERM')
      await closed
      const kib = RSS_LINE.exec(stderr)?.[1]
      if (!kib) {
        throw new Error(`the CLI did not report its peak RSS\n--- stderr\n${stderr}`)
      }
      return Number(kib) * 1024
    },
  }
}
