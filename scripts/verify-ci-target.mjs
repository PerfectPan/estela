#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireCondition(condition, message) {
  if (!condition)
    throw new Error(message)
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function api(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))
}

function documentationPath(path) {
  return /^(?:docs|specs)\/.*\.md$/.test(path)
    || /^(?:AGENTS|CLAUDE|CONTRIBUTING|README)(?:\.[\w-]+)?\.md$/.test(path)
    || /^(?:apps|packages)\/[^/]+\/README(?:\.[\w-]+)?\.md$/.test(path)
}

try {
  const repository = process.env.GITHUB_REPOSITORY ?? ''
  const head = process.env.CI_HEAD_SHA ?? ''
  const base = process.env.CI_BASE_SHA ?? ''
  const prNumber = process.env.CI_PR_NUMBER ?? ''
  const branch = process.env.CI_BRANCH ?? ''
  requireCondition(/^[\w.-]+\/[\w.-]+$/.test(repository), 'missing repository')
  requireCondition(/^[a-f0-9]{40}$/.test(head) && /^[a-f0-9]{40}$/.test(base), 'full head/base SHAs required')
  requireCondition(/^[1-9]\d*$/.test(prNumber) && branch !== '', 'open PR number and actual branch required')
  requireCondition(head !== base, 'empty comparison')
  requireCondition(git('rev-parse', 'HEAD') === head, 'checkout does not match requested head')
  requireCondition(git('merge-base', base, head) === base, 'head must include the current PR base')

  const pr = api(`repos/${repository}/pulls/${prNumber}`)
  requireCondition(pr.state === 'open', 'PR is not open')
  requireCondition(pr.head.repo?.full_name === repository && pr.base.repo?.full_name === repository, 'same-repository PR required')
  requireCondition(pr.head.ref === branch && pr.head.sha === head, 'PR head changed or branch mismatch')
  requireCondition(pr.base.sha === base, 'PR base changed; update the branch and request a new run')
  const ref = api(`repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`)
  requireCondition(ref.object?.sha === head, 'live branch changed')
  execFileSync(join(dirname(fileURLToPath(import.meta.url)), 'check-pr-title.sh'), [pr.title], { stdio: 'inherit' })

  // Disabling rename detection keeps a source deletion visible even when its new name is Markdown.
  const paths = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], { encoding: 'utf8' })
    .split('\0').filter(Boolean)
  requireCondition(paths.length > 0, 'empty tree comparison')
  const gate = paths.every(documentationPath) ? 'docs' : 'full'
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `gate=${gate}\nbase_sha=${base}\nhead_sha=${head}\n`)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `PR #${prNumber}: ${branch}\n\nHead: ${head}\n\nBase: ${base}\n\nGate: ${gate}\n`)
  console.log(`verify-ci-target: ok (${gate}, PR #${prNumber}, ${head} / ${base})`)
}
catch (error) {
  console.error(`verify-ci-target: ${error.message}`)
  process.exitCode = 1
}
