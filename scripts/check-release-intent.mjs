#!/usr/bin/env node
// Checks that a change to the public interface reference carries the matching release changeset(s):
// lines under the dsh plugin section (`@rivus/dsh-estela`) need a release changeset for `@rivus/dsh-estela`;
// lines anywhere else in docs/reference/public-interface.md need one for `@rivus/estela`; edits to both
// regions need both. Which level is right stays with review, by the version policy in that document;
// this check catches only a missing release changeset.
// See CONTRIBUTING.md#release-intent.
//
// Usage: node scripts/check-release-intent.mjs [base]
// `base` is the commit the change is compared with: CI passes HEAD^1, the base side of the pull request's
// merge commit. Without it, the merge base of origin/main and HEAD.
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const INTERFACE = 'docs/reference/public-interface.md'
const CLI_PACKAGE = '@rivus/estela'
const PLUGIN_PACKAGE = '@rivus/dsh-estela'
const RELEASE = new Set(['patch', 'minor', 'major'])
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/
const FENCE = /^(`{3,}|~{3,})/

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function showFile(rev, path, cwd) {
  try {
    return git(['show', `${rev}:${path}`], cwd)
  } catch {
    return ''
  }
}

/** Package bumps declared in a changeset file's front matter. */
export function bumpsOf(content) {
  const bumps = new Map()
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  for (const line of front?.[1].split(/\r?\n/) ?? []) {
    const entry = /^\s*(['"]?)([^'":]+)\1\s*:\s*(\w+)\s*$/.exec(line)
    if (entry) {
      bumps.set(entry[2], entry[3])
    }
  }
  return bumps
}

/** Maps each 1-based line number of `text` to the package owning its nearest enclosing heading. */
export function lineOwners(text) {
  const lines = text.split(/\r?\n/)
  const owners = [CLI_PACKAGE]
  let fenceChar
  let fenceLen = 0
  let pluginLevel
  for (const line of lines) {
    const trimmed = line.trimStart()
    const fence = FENCE.exec(trimmed)
    if (fence) {
      const marker = fence[1]
      if (!fenceChar) {
        fenceChar = marker[0]
        fenceLen = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && trimmed.slice(marker.length).trim() === '') {
        fenceChar = undefined
        fenceLen = 0
      }
    } else if (!fenceChar) {
      const heading = HEADING.exec(line)
      if (heading) {
        const level = heading[1].length
        if (heading[2].includes(PLUGIN_PACKAGE)) {
          pluginLevel = level
        } else if (pluginLevel !== undefined && level <= pluginLevel) {
          pluginLevel = undefined
        }
      }
    }
    owners.push(pluginLevel !== undefined ? PLUGIN_PACKAGE : CLI_PACKAGE)
  }
  return { lines, owners }
}

/**
 * Returns the package(s) whose covered regions changed in `diffText` (`git diff --unified=0`).
 * Blank lines in a hunk are skipped when the hunk also has non-blank lines, so inserting or removing
 * a separator line next to a section heading does not implicate the adjacent section.
 */
export function requiredPackages(oldText, newText, diffText) {
  const oldDoc = lineOwners(oldText)
  const newDoc = lineOwners(newText)
  const required = new Set()
  for (const line of diffText.split(/\r?\n/)) {
    const match = HUNK_HEADER.exec(line)
    if (!match) {
      continue
    }
    const oldStart = Number(match[1])
    const oldCountRaw = match.at(2)
    const oldCount = oldCountRaw === undefined ? 1 : Number(oldCountRaw)
    const newStart = Number(match[3])
    const newCountRaw = match.at(4)
    const newCount = newCountRaw === undefined ? 1 : Number(newCountRaw)
    const hunkNonBlank = new Set()
    const hunkAny = new Set()
    const collect = (doc, start, count) => {
      if (count === 0) {
        return
      }
      for (let lineNo = start; lineNo < start + count; lineNo += 1) {
        const owner = doc.owners[lineNo] ?? CLI_PACKAGE
        hunkAny.add(owner)
        if ((doc.lines[lineNo - 1] ?? '').trim().length > 0) {
          hunkNonBlank.add(owner)
        }
      }
    }
    collect(oldDoc, oldStart, oldCount)
    collect(newDoc, newStart, newCount)
    const chosen = hunkNonBlank.size > 0 ? hunkNonBlank : hunkAny
    for (const pkg of chosen) {
      required.add(pkg)
    }
  }
  if (required.size === 0) {
    required.add(CLI_PACKAGE)
  }
  return [CLI_PACKAGE, PLUGIN_PACKAGE].filter(pkg => required.has(pkg))
}

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  // `git diff --name-only` names files from the repository root, wherever the script runs.
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim()
  const base = argv[0] ?? git(['merge-base', 'origin/main', 'HEAD'], root).trim()
  const changed = git(['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD'], root)
    .trim()
    .split('\n')
    .filter(Boolean)

  if (!changed.includes(INTERFACE)) {
    console.log(`release intent: ${INTERFACE} unchanged`)
    return 0
  }

  const diffText = git(['diff', '--unified=0', base, 'HEAD', '--', INTERFACE], root)
  const needed = requiredPackages(showFile(base, INTERFACE, root), showFile('HEAD', INTERFACE, root), diffText)
  const changesets = changed.filter(path => /^\.changeset\/[^/]+\.md$/.test(path) && path !== '.changeset/README.md')
  const releasedBy = new Map()
  for (const path of changesets) {
    const bumps = bumpsOf(readFileSync(join(root, path), 'utf8'))
    for (const pkg of needed) {
      if (RELEASE.has(bumps.get(pkg))) {
        const list = releasedBy.get(pkg) ?? []
        list.push(path)
        releasedBy.set(pkg, list)
      }
    }
  }

  const missing = needed.filter(pkg => !releasedBy.has(pkg))
  if (missing.length > 0) {
    console.error(
      `release intent: ${INTERFACE} changed, but no changeset in this change releases ${missing.join(', ')} (patch, minor, or major).`,
    )
    console.error('Add one with `pnpm exec changeset`; see CONTRIBUTING.md#release-intent for the level.')
    return 1
  }

  const summary = needed.map(pkg => `${pkg} (${releasedBy.get(pkg).join(', ')})`).join('; ')
  console.log(`release intent: ${INTERFACE} changed; released by ${summary}`)
  return 0
}

function canonicalPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

if (process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))) {
  process.exit(main())
}
