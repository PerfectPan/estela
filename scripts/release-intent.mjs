#!/usr/bin/env node
// Release intent for @rivus/agent-trace. See CONTRIBUTING.md#release-intent.
//
// `rush change --verify` only sees files inside the published project's folder. The CLI also bundles
// every other workspace project, so this script requires a change file when any shipped file under
// apps/ or packages/, or the lockfile, changes, and writes one in Rush's format when `rush change` finds nothing to do.
//
//   node scripts/release-intent.mjs check --base <sha>
//   node scripts/release-intent.mjs add --type <major|minor|patch|none> --message "<text>"
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const PACKAGE = '@rivus/agent-trace'
const CHANGE_DIR = join('common', 'changes', PACKAGE)
const TYPES = ['major', 'minor', 'patch', 'none']

/** Files that end up in the published bundle or change its dependencies. */
function ships(path) {
  if (path === 'common/config/rush/pnpm-lock.yaml')
    return true
  if (!path.startsWith('packages/') && !path.startsWith('apps/'))
    return false
  return !/\.test\.[cm]?[jt]sx?$/.test(path)
    && !/(^|\/)fixtures\//.test(path)
    && !path.endsWith('.md')
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function check(base) {
  if (!base)
    fail('check needs --base <sha>')
  const changed = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean)
  const shipped = changed.filter(ships)
  const intents = changed.filter(p => p.startsWith(`${CHANGE_DIR}/`) && p.endsWith('.json'))
  if (shipped.length === 0) {
    console.log('release-intent: ok (no shipped files changed)')
    return
  }
  if (intents.length > 0) {
    console.log(`release-intent: ok (${intents.length} change file${intents.length === 1 ? '' : 's'} for ${shipped.length} shipped file${shipped.length === 1 ? '' : 's'})`)
    return
  }
  console.error(`release-intent: ${shipped.length} shipped file(s) changed without a change file for ${PACKAGE}:`)
  for (const p of shipped.slice(0, 20))
    console.error(`  - ${p}`)
  if (shipped.length > 20)
    console.error(`  … and ${shipped.length - 20} more`)
  console.error('Add one with: node common/scripts/install-run-rush.js change')
  console.error(`If Rush reports nothing to do: node scripts/release-intent.mjs add --type <${TYPES.join('|')}> --message "<what changed for users>"`)
  process.exit(1)
}

function add(type, message) {
  if (!TYPES.includes(type))
    fail(`--type must be one of ${TYPES.join(', ')}`)
  if (type !== 'none' && !message?.trim())
    fail('--message is required unless --type none')
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').replace(/[^\w.-]+/g, '-')
  const email = git('config', 'user.email')
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`
  const file = join(CHANGE_DIR, `${branch}_${stamp}.json`)
  const body = {
    changes: [{ packageName: PACKAGE, comment: message?.trim() ?? '', type }],
    packageName: PACKAGE,
    email,
  }
  mkdirSync(CHANGE_DIR, { recursive: true })
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: 'wx' })
  console.log(`release-intent: wrote ${file}`)
}

function fail(message) {
  console.error(`release-intent: ${message}`)
  process.exit(1)
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { base: { type: 'string' }, type: { type: 'string' }, message: { type: 'string' } },
})
if (positionals[0] === 'check')
  check(values.base)
else if (positionals[0] === 'add')
  add(values.type, values.message)
else
  fail('usage: release-intent.mjs check --base <sha> | add --type <major|minor|patch|none> --message "<text>"')
