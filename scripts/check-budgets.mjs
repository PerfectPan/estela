#!/usr/bin/env node
// Measures the built CLI against the budgets in scripts/budgets/budgets.mjs: time to the first
// session rows, a large session's load time and peak RSS, and the artifact sizes.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { BUDGETS, LARGE_SESSION_BYTES, SESSIONS_PER_AGENT } from './budgets/budgets.mjs'
import { startServer } from './budgets/cli-server.mjs'
import { measureSizes } from './budgets/sizes.mjs'
import { writeSyntheticHome } from './budgets/synthetic-home.mjs'

const HELP = `Usage:
  node scripts/check-budgets.mjs [--help]

Runs the built CLI (apps/cli/dist) and measures the built dsh plugin
(apps/dsh-plugin/dist; run "pnpm build" and
"pnpm --filter '@rivus/dsh-estela...' run build" first) on synthetic data
generated into a temp directory, and checks the numbers against the budgets in
scripts/budgets/budgets.mjs:

  first rows       ${SESSIONS_PER_AGENT * 2} sessions (Claude Code and Codex), from process start to the
                   first list-sessions response with every row; cold (no index)
                   and warm (index from the cold run)
  large session    a ${Math.round(LARGE_SESSION_BYTES / 1e6)} MB Codex rollout given on the command line, from
                   process start to the get-trace-view response, and peak RSS
  sizes            web JS and CSS (raw, gzip), dist/cli.mjs, the CLI tarball,
                   dsh plugin dist/client.js (raw, gzip), dist/host.mjs, and the plugin tarball

Prints a table, appends it to $GITHUB_STEP_SUMMARY when that is set, and exits 1
when an enforced budget is exceeded. ESTELA_BUDGETS_KEEP=1 keeps the temp directory.
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
if (process.argv.length > 2) {
  process.stderr.write(`check-budgets: unknown argument ${process.argv[2]}\n\n${HELP}`)
  process.exit(2)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
if (!existsSync(join(root, 'apps/cli/dist/cli.mjs')) || !existsSync(join(root, 'apps/cli/dist/web/assets'))) {
  process.stderr.write('check-budgets: apps/cli/dist is missing. Run "pnpm build" first.\n')
  process.exit(1)
}
if (
  !existsSync(join(root, 'apps/dsh-plugin/dist/host.mjs'))
  || !existsSync(join(root, 'apps/dsh-plugin/dist/client.js'))
) {
  process.stderr.write(
    `check-budgets: apps/dsh-plugin/dist is missing. Run "pnpm --filter '@rivus/dsh-estela...' run build" first.\n`,
  )
  process.exit(1)
}

const READY_TIMEOUT_MS = 120_000
/** How long the cold server may take to summarize every session before the warm run starts anyway. */
const IDLE_TIMEOUT_MS = 120_000
/** Longer than the catalog's 150 ms flush, so the last batch of summaries is in the index. */
const FLUSH_WAIT_MS = 500

/** Printed per agent by a start that served its rows from the index (`sayIndexFromCache`). */
const FROM_INDEX = /^Claude Code: \d+ sessions from the index$/m

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * One launch on the synthetic home. "First rows" is what the session browser waits for: the dev
 * server listens only after the catalog has rows (from the index, or from the first `discover`
 * pass), and the SPA's first call is `list-sessions({})`. The clock stops when that call returns
 * every generated session. The cold run then waits for every summary, so the warm run's index holds them.
 */
/**
 * Runs `use` on a started server, then stops it and returns its peak RSS. When `use` throws, that
 * error is the one reported; a failed stop after it would only hide the cause.
 */
async function withServer(server, use) {
  let result
  try {
    result = await use()
  } catch (error) {
    await server.stop().catch(() => {})
    throw error
  }
  return { ...result, peakRss: await server.stop() }
}

async function firstRows(env, expected, warm) {
  const server = await startServer(root, [], env, READY_TIMEOUT_MS)
  return withServer(server, async () => {
    const listed = await server.call('list-sessions', {})
    const firstMs = performance.now() - server.startedAt
    if (listed.rows.length !== expected) {
      throw new Error(`list-sessions returned ${listed.rows.length} rows, expected ${expected}`)
    }
    // A warm start that waits for discover again is only about as slow as a cold one, which no
    // time budget can tell apart on a slow runner; the CLI's own line says where the rows came from.
    if (warm && !FROM_INDEX.test(server.output().stdout)) {
      throw new Error(`the warm start did not serve rows from the index\n${server.output().stdout}`)
    }
    let idleMs
    if (!warm) {
      const deadline = performance.now() + IDLE_TIMEOUT_MS
      let { pending, revision } = listed
      while (pending > 0 && performance.now() < deadline) {
        await delay(100)
        ;({ pending, revision } = await server.call('list-sessions', { since: revision }))
      }
      idleMs = pending === 0 ? performance.now() - server.startedAt : undefined
      await delay(FLUSH_WAIT_MS)
    }
    return { firstMs, idleMs }
  })
}

/** `packages/server/src/testsupport/large-session.ts` run by path, as the S12 browser test does. */
function writeLargeSession(dir) {
  const stdout = execFileSync(
    process.execPath,
    [join(root, 'packages/server/src/testsupport/large-session.ts'), dir, String(LARGE_SESSION_BYTES)],
    { encoding: 'utf8' },
  )
  return JSON.parse(stdout)
}

/**
 * `estela <path>` loads the session before the server listens; the clock stops when
 * `get-trace-view`, the workspace's call, returns. Peak RSS is the whole process's.
 */
async function largeSession(dir, env) {
  const session = writeLargeSession(join(dir, 'large'))
  const server = await startServer(root, [session.path], env, READY_TIMEOUT_MS)
  const measured = await withServer(server, async () => {
    const view = await server.call('get-trace-view', { traceId: server.traceId })
    const viewMs = performance.now() - server.startedAt
    if (view.trace.events.length === 0) {
      throw new Error('get-trace-view returned no events for the large session')
    }
    return { viewMs }
  })
  return { bytes: session.bytes, ...measured }
}

/** Decimal units, as the budgets and Vite's build output use. */
const formats = {
  ms: value => `${(value / 1000).toFixed(2)} s`,
  bytes: value => (value >= 2e6 ? `${(value / 1e6).toFixed(1)} MB` : `${(value / 1e3).toFixed(1)} kB`),
}

function table(results) {
  const lines = ['| Metric | Measured | Budget | Status |', '|---|---|---|---|']
  for (const { budget, value } of results) {
    const format = formats[budget.unit]
    const measured = value === undefined ? 'not reached' : format(value)
    const status =
      value !== undefined && value <= budget.limit ? 'ok' : budget.enforced ? '**over budget**' : 'over (reported)'
    lines.push(
      `| ${budget.label} | ${measured} | ${format(budget.limit)}${budget.enforced ? '' : ' (reported)'} | ${status} |`,
    )
  }
  return lines.join('\n')
}

const dir = mkdtempSync(join(tmpdir(), 'estela-budgets-'))
let failed = false
try {
  const home = join(dir, 'home')
  const synthetic = writeSyntheticHome(home, SESSIONS_PER_AGENT)
  const expected = Object.values(synthetic.sessions).reduce((sum, count) => sum + count, 0)
  const env = { HOME: home, XDG_CACHE_HOME: join(dir, 'cache') }
  const cold = await firstRows(env, expected, false)
  const warm = await firstRows(env, expected, true)
  const large = await largeSession(dir, { HOME: join(dir, 'empty-home'), XDG_CACHE_HOME: join(dir, 'cache-large') })
  const sizes = measureSizes(root, dir)
  const measured = {
    'first-rows-cold': cold.firstMs,
    'first-rows-warm': warm.firstMs,
    'all-summaries-cold': cold.idleMs,
    'large-session-view': large.viewMs,
    'large-session-rss': large.peakRss,
    ...sizes,
  }
  const results = BUDGETS.map(budget => ({ budget, value: measured[budget.id] }))
  failed = results.some(({ budget, value }) => budget.enforced && !(value !== undefined && value <= budget.limit))
  const intro =
    `Synthetic home: ${expected} sessions, ${(synthetic.bytes / 1e6).toFixed(0)} MB; `
    + `large session: ${(large.bytes / 1e6).toFixed(0)} MB. Budgets: scripts/budgets/budgets.mjs.`
  const report = `${intro}\n\n${table(results)}\n`
  process.stdout.write(report)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Performance and size budgets\n\n${report}\n`)
  }
} finally {
  if (process.env.ESTELA_BUDGETS_KEEP === '1') {
    process.stdout.write(`Kept ${dir}\n`)
  } else {
    rmSync(dir, { recursive: true, force: true })
  }
}
if (failed) {
  process.stderr.write('check-budgets: an enforced budget is exceeded; see scripts/budgets/budgets.mjs.\n')
}
process.exitCode = failed ? 1 : 0
