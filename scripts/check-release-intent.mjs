#!/usr/bin/env node
// Checks that a change to the public interface reference carries a release changeset: a pull request that
// edits docs/reference/public-interface.md changes a covered surface, so it must add or edit a changeset that
// releases @rivus/estela (patch, minor, or major). Which level is right stays with review, by the version
// policy in that document; this check catches only a missing one.
// See CONTRIBUTING.md#release-intent.
//
// Usage: node scripts/check-release-intent.mjs [base]
// `base` is the commit the change is compared with: CI passes HEAD^1, the base side of the pull request's
// merge commit. Without it, the merge base of origin/main and HEAD.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const INTERFACE = 'docs/reference/public-interface.md'
const PACKAGE = '@rivus/estela'
const RELEASE = new Set(['patch', 'minor', 'major'])

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

// `git diff --name-only` names files from the repository root, wherever the script runs.
const root = git('rev-parse', '--show-toplevel')

/** The bump a changeset file gives `PACKAGE`, from its front matter; `undefined` when it does not name it. */
function bumpOf(path) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(root, path), 'utf8'))
  for (const line of front?.[1].split(/\r?\n/) ?? []) {
    const entry = /^\s*(['"]?)([^'":]+)\1\s*:\s*(\w+)\s*$/.exec(line)
    if (entry?.[2] === PACKAGE) {
      return entry[3]
    }
  }
  return undefined
}

const base = process.argv[2] ?? git('merge-base', 'origin/main', 'HEAD')
const changed = git('diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD').split('\n').filter(Boolean)

if (!changed.includes(INTERFACE)) {
  console.log(`release intent: ${INTERFACE} unchanged`)
  process.exit(0)
}
const changesets = changed.filter(path => /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md')
const releasing = changesets.filter(path => RELEASE.has(bumpOf(path)))
if (releasing.length === 0) {
  console.error(
    `release intent: ${INTERFACE} changed, but no changeset in this change releases ${PACKAGE} (patch, minor, or major).`,
  )
  console.error('Add one with `pnpm exec changeset`; see CONTRIBUTING.md#release-intent for the level.')
  process.exit(1)
}
console.log(`release intent: ${INTERFACE} changed; released by ${releasing.join(', ')}`)
