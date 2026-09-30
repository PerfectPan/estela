import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-ci-target.mjs')

function fixture(t, path = 'docs/guide.md') {
  const root = mkdtempSync(join(tmpdir(), 'agent-trace-ci-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'CI fixture')
  git('config', 'user.email', 'ci@example.com')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.hooksPath', join(root, 'fixture-hooks'))
  const write = (filePath, text) => {
    mkdirSync(dirname(join(root, filePath)), { recursive: true })
    writeFileSync(join(root, filePath), text)
  }
  const commit = () => {
    git('add', '.')
    git('commit', '-q', '-m', 'test: fixture')
    return git('rev-parse', 'HEAD')
  }
  write('README.md', 'initial\n')
  write('packages/kernel/src/example.ts', 'export const value = 1\n')
  const base = commit()
  git('checkout', '-q', '-b', 'ci/cost')
  write(path, 'changed\n')
  let head = commit()
  const stateFile = join(root, 'metadata.json')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const { readFileSync } = require('node:fs')
const state = JSON.parse(readFileSync(process.env.CI_FIXTURE_STATE, 'utf8'))
const endpoint = process.argv[3]
if (endpoint === 'repos/example/trace/pulls/1') console.log(JSON.stringify(state.pr))
else if (endpoint === 'repos/example/trace/git/ref/heads/ci%2Fcost') console.log(JSON.stringify(state.ref))
else process.exit(2)
`)
  chmodSync(join(bin, 'gh'), 0o755)
  const output = join(root, 'output')
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REPOSITORY: 'example/trace',
    CI_HEAD_SHA: head,
    CI_BASE_SHA: base,
    CI_PR_NUMBER: '1',
    CI_BRANCH: 'ci/cost',
    CI_FIXTURE_STATE: stateFile,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: join(root, 'summary'),
  }
  const state = {
    pr: {
      state: 'open', title: 'ci: reduce Actions use',
      head: { ref: 'ci/cost', sha: head, repo: { full_name: 'example/trace' } },
      base: { sha: base, repo: { full_name: 'example/trace' } },
    },
    ref: { object: { sha: head } },
  }
  function run(overrides = {}) {
    writeFileSync(stateFile, JSON.stringify(state))
    return spawnSync(process.execPath, [script], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' })
  }
  function renameSource() {
    git('mv', 'packages/kernel/src/example.ts', 'docs/source.md')
    // Fixture controls and outputs do not belong to the comparison.
    git('add', 'docs/source.md')
    git('commit', '-q', '-m', 'test: rename source')
    head = git('rev-parse', 'HEAD')
    env.CI_HEAD_SHA = head
    state.pr.head.sha = head
    state.ref.object.sha = head
  }
  return { root, git, env, state, run, output, renameSource }
}

test('documentation uses the light gate and records the exact comparison', (t) => {
  const f = fixture(t)
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(f.output, 'utf8'), /^gate=docs\nbase_sha=[a-f0-9]{40}\nhead_sha=[a-f0-9]{40}\n$/)
})

for (const path of ['apps/web/src/view.ts', '.github/workflows/ci.yml', 'scripts/tool.mjs', 'common/config/rush/pnpm-lock.yaml', 'docs/schema.json']) {
  test(`${path} requires the complete gate`, (t) => {
    const f = fixture(t, path)
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(readFileSync(f.output, 'utf8'), /^gate=full\n/)
  })
}

test('renaming source into Markdown still requires the complete gate', (t) => {
  const f = fixture(t)
  f.renameSource()
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  assert.match(readFileSync(f.output, 'utf8'), /^gate=full\n/)
})

for (const [label, mutate, expected] of [
  ['closed PR', f => f.state.pr.state = 'closed', /PR is not open/],
  ['fork PR', f => f.state.pr.head.repo.full_name = 'fork/trace', /same-repository/],
  ['stale PR head', f => f.state.pr.head.sha = f.env.CI_BASE_SHA, /PR head changed/],
  ['wrong branch', f => f.state.pr.head.ref = 'other', /branch mismatch/],
  ['changed base', f => f.state.pr.base.sha = f.env.CI_HEAD_SHA, /PR base changed/],
  ['changed live ref', f => f.state.ref.object.sha = f.env.CI_BASE_SHA, /live branch changed/],
  ['invalid title', f => f.state.pr.title = 'invalid title', /title must match/],
]) {
  test(`${label} cannot produce successful CI evidence`, (t) => {
    const f = fixture(t)
    mutate(f)
    const result = f.run()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, expected)
  })
}

test('a second verification rejects a head moved after the gate', (t) => {
  const f = fixture(t)
  assert.equal(f.run().status, 0)
  f.state.ref.object.sha = f.env.CI_BASE_SHA
  assert.match(f.run().stderr, /live branch changed/)
})

test('malformed or mismatched requests fail before running checks', (t) => {
  const f = fixture(t)
  for (const overrides of [{ CI_HEAD_SHA: 'main' }, { CI_PR_NUMBER: '' }, { CI_BRANCH: '' }, { CI_HEAD_SHA: f.env.CI_BASE_SHA }]) {
    assert.notEqual(f.run(overrides).status, 0)
  }
})

test('the requested head must contain the supplied base', (t) => {
  const f = fixture(t)
  const head = f.env.CI_HEAD_SHA
  f.git('checkout', '-q', 'main')
  writeFileSync(join(f.root, 'README.md'), 'new main\n')
  f.git('add', 'README.md')
  f.git('commit', '-q', '-m', 'test: advance main')
  const base = f.git('rev-parse', 'HEAD')
  f.git('checkout', '-q', head)
  assert.match(f.run({ CI_BASE_SHA: base }).stderr, /head must include/)
})


test('CI can omit builds that repeat the completed typecheck', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const { projects } = JSON.parse(readFileSync(join(root, 'rush.json'), 'utf8'))
  for (const project of projects) {
    if (project.packageName === '@rivus/agent-trace-web')
      continue
    const { scripts } = JSON.parse(readFileSync(join(root, project.projectFolder, 'package.json'), 'utf8'))
    assert.equal(scripts.typecheck, 'tsc --noEmit', `${project.packageName}: update CI for the changed typecheck`)
    assert.equal(scripts.build, scripts.typecheck, `${project.packageName}: CI must run the new build operation`)
  }
})
