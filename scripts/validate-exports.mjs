#!/usr/bin/env node
// Acceptance evidence for the ATIF export (scenarios A1 and A2 in docs/development/setup.md): export every
// registered agent's fixture sessions with the CLI, then validate each output with
// Harbor's ATIF validator. A manual gate, not part of `pnpm test`: it needs uv and
// network access for the first `uv run` (Python 3.12 plus the `harbor` package).
//
//   node scripts/validate-exports.mjs
//
// Exits 1 and prints one line per failed export or validation.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const cli = join(repo, 'apps/cli/bin.mjs')
const fixtures = join(repo, 'fixtures/sessions')
const UV_ARGS = [
  'run',
  '--python',
  '3.12',
  '--with',
  'harbor',
  '--quiet',
  'python',
  '-m',
  'harbor.utils.trajectory_validator',
]

/** Session entry files under one agent's conformance fixtures, relative to `fixtures/sessions`. */
function sessionFiles(agentRoot, agent, base = '', out = []) {
  for (const name of readdirSync(join(agentRoot, base))) {
    const path = join(base, name)
    if (statSync(join(agentRoot, path)).isDirectory()) {
      sessionFiles(agentRoot, agent, path, out)
    } else if (
      name === 'session.jsonl'
      || name === 'session.v4.jsonl'
      || name.startsWith('session-')
      || name === 'updates.jsonl'
      || name.startsWith('rollout-')
      || name === 'opencode.db'
    ) {
      out.push(join(agent, path))
    }
  }
  return out
}

const agents = readdirSync(fixtures).filter(name => !name.startsWith('.'))
const sessions = agents.flatMap(agent => sessionFiles(join(fixtures, agent), agent))

const work = mkdtempSync(join(tmpdir(), 'at-validate-'))
let failed = 0
try {
  for (const session of sessions) {
    const source = join(fixtures, session) + (session.endsWith('opencode.db') ? '#ses_smoke' : '')
    const out = join(work, `${session.replaceAll('/', '-')}.atif.json`)
    try {
      execFileSync(process.execPath, [cli, 'export-atif', source, '--out', out], { stdio: 'pipe' })
    } catch (error) {
      const expected = session.includes('/unknown-generation/')
        ? 'unknown format generation'
        : ['grok', 'pi', 'dsh', 'gemini-cli'].some(agent => session.startsWith(agent + '/conformance/unknown-type/'))
          ? 'No events an ATIF step can come from'
          : undefined
      const message = String(error.stderr ?? error.message).split('\n')[0]
      const expectedFailure = expected !== undefined && message.includes(expected)
      if (!expectedFailure) {
        failed += 1
      }
      process.stdout.write(`${expectedFailure ? 'SKIP' : 'FAIL'}  ${session}: ${message}\n`)
      continue
    }
    try {
      execFileSync('uv', [...UV_ARGS, out], { stdio: 'pipe' })
      process.stdout.write(`PASS  ${session}\n`)
    } catch (error) {
      failed += 1
      process.stdout.write(`FAIL  ${session}\n${String(error.stdout ?? '')}${String(error.stderr ?? '')}\n`)
    }
  }
  process.stdout.write(
    `\n${failed === 0 ? 'All exports passed' : `${failed} export(s) failed`}: Harbor validator ${UV_ARGS.join(' ')}\n`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
process.exit(failed === 0 ? 0 : 1)
