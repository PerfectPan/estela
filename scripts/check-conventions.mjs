#!/usr/bin/env node
// Repository conventions for tracked files. See CONTRIBUTING.md#file-conventions.
// 1. Every file and directory name is kebab-case, except the names listed below.
// 2. A code file under apps/, packages/, or scripts/ has at most 500 lines.
// 3. No tracked file, documentation included, names the company npm mirror: installs use the public
//    registry (`registry` in pnpm-workspace.yaml). The shared check's `forbid` would skip AGENTS.md,
//    CONTRIBUTING.md, and SECURITY.md, so the scan is here.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const MAX_LINES = 500
/** The mirror's name, spelled as character classes so that this file does not match it. */
const MIRROR = '[Bb][Nn][Pp][Mm]'
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Names fixed by convention or by a platform. */
const FIXED_NAMES = new Set([
  'AGENTS.md',
  'CHANGELOG.json',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'SKILL.md',
])
/** Paths whose names a platform or tool decides. */
const FIXED_PATHS = [
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/pull_request_template\.md$/,
  /^\.gitlab\/merge_request_templates\//,
]
/** Suffix segments after the stem that are not kebab-case by design. */
const LOCALE_SUFFIX = /^[a-z]{2}-[A-Z]{2}$/

const CODE = /\.(?:[cm]?[jt]sx?|css)$/
const CODE_ROOTS = /^(?:apps|packages|scripts)\//
const NOT_CODE = /(?:^|\/)fixtures\//
/** Session fixtures mirror on-disk log names, which are not all kebab-case. */
const FIXTURE_MIRROR = /^fixtures\//

function nameProblems(path) {
  if (FIXED_PATHS.some(re => re.test(path)) || FIXTURE_MIRROR.test(path)) {
    return []
  }
  const problems = []
  const parts = path.split('/')
  parts.forEach((part, i) => {
    const isFile = i === parts.length - 1
    if (isFile && FIXED_NAMES.has(part)) {
      return
    }
    const bare = part.startsWith('.') ? part.slice(1) : part
    if (!isFile) {
      if (!KEBAB.test(bare)) {
        problems.push(`directory "${part}" in ${path} is not kebab-case`)
      }
      return
    }
    const [stem, ...suffixes] = bare.split('.')
    const middle = suffixes.slice(0, -1)
    if (!KEBAB.test(stem) || middle.some(s => !KEBAB.test(s) && !LOCALE_SUFFIX.test(s))) {
      problems.push(`file "${part}" in ${path} is not kebab-case`)
    }
  })
  return problems
}

function lineProblem(path) {
  if (!CODE_ROOTS.test(path) || !CODE.test(path) || NOT_CODE.test(path)) {
    return null
  }
  const text = readFileSync(path, 'utf8')
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  return lines > MAX_LINES ? `${path} has ${lines} lines; the limit for code is ${MAX_LINES}` : null
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const problems = new Set()
for (const path of files) {
  for (const p of nameProblems(path)) {
    problems.add(p)
  }
  const lines = lineProblem(path)
  if (lines) {
    problems.add(lines)
  }
}

// git grep exits 1 when nothing matches; above 1 is an error, which must not pass.
const mirror = spawnSync('git', ['grep', '-n', '-I', '-E', '-e', MIRROR], { encoding: 'utf8' })
if (mirror.status === 0) {
  for (const line of mirror.stdout.split('\n').filter(Boolean)) {
    problems.add(`${line.slice(0, line.indexOf(':', line.indexOf(':') + 1))} names the company npm mirror`)
  }
} else if (mirror.status !== 1) {
  throw new Error(`git grep failed: ${mirror.stderr}`)
}

if (problems.size) {
  console.error('check-conventions: failed')
  for (const p of [...problems].toSorted((a, b) => a.localeCompare(b))) {
    console.error(`  - ${p}`)
  }
  process.exit(1)
}
console.log(`check-conventions: ok (${files.length} files)`)
