import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { bumpsOf, requiredPackages } from './check-release-intent.mjs'

const SCRIPT = fileURLToPath(new URL('./check-release-intent.mjs', import.meta.url))
const INTERFACE = 'docs/reference/public-interface.md'

const FIXTURE_BASE = `# Public interface and compatibility

## Covered

### Command line

| Command | Argument |
|---|---|
| \`estela\` | \`[session]\` |

### dsh plugin (\`@rivus/dsh-estela\`)

Install with \`dsh plugin add @rivus/dsh-estela\`.

\`\`\`sh
# Comment inside a fenced block must not end the plugin section
dsh plugin remove @rivus/dsh-estela
\`\`\`

#### Environment

\`ESTELA_REDACT=0\` disables redaction.

## Experimental

- **OTLP export.** Experimental mapping.

## Not covered

- **Workspace packages.** Internal only.
`

const FIXTURE_WITHOUT_PLUGIN = `# Public interface and compatibility

## Covered

### Command line

| Command | Argument |
|---|---|
| \`estela\` | \`[session]\` |

## Experimental

- **OTLP export.** Experimental mapping.
`

const dirs = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

function writeRepoFile(repo, relPath, content) {
  const full = join(repo, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

function createFixtureRepo(initialDoc = FIXTURE_BASE) {
  const repo = mkdtempSync(join(tmpdir(), 'estela-release-intent-'))
  dirs.push(repo)
  git(repo, 'init', '-b', 'main')
  writeRepoFile(repo, INTERFACE, initialDoc)
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  return { repo, base }
}

function commitChange(repo, files) {
  for (const [relPath, content] of Object.entries(files)) {
    writeRepoFile(repo, relPath, content)
  }
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'change')
}

function runCheck(repo, base) {
  const result = spawnSync(process.execPath, [SCRIPT, base], { cwd: repo, encoding: 'utf8' })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

describe('check-release-intent.mjs', () => {
  it('requires only @rivus/dsh-estela when only the plugin section changes', () => {
    const { repo, base } = createFixtureRepo()
    const editedDoc = FIXTURE_BASE.replace(
      'Install with `dsh plugin add @rivus/dsh-estela`.',
      'Install with `dsh plugin add @rivus/dsh-estela` (requires dsh 0.2.x).',
    )
    commitChange(repo, { [INTERFACE]: editedDoc })

    const noChangeset = runCheck(repo, base)
    assert.equal(noChangeset.status, 1)
    assert.match(noChangeset.stderr, /@rivus\/dsh-estela/)
    assert.doesNotMatch(noChangeset.stderr, /@rivus\/estela/)

    commitChange(repo, {
      '.changeset/cli-only.md': '---\n"@rivus/estela": patch\n---\n\nCLI fix.\n',
    })
    const cliOnly = runCheck(repo, base)
    assert.equal(cliOnly.status, 1)
    assert.match(cliOnly.stderr, /@rivus\/dsh-estela/)

    commitChange(repo, {
      '.changeset/plugin-none.md': '---\n"@rivus/dsh-estela": none\n---\n\nInternal plugin change.\n',
    })
    const pluginNone = runCheck(repo, base)
    assert.equal(pluginNone.status, 1)
    assert.match(pluginNone.stderr, /@rivus\/dsh-estela/)

    commitChange(repo, {
      '.changeset/plugin-fix.md': '---\n"@rivus/dsh-estela": patch\n---\n\nUpdate plugin install note.\n',
    })
    const pluginPatch = runCheck(repo, base)
    assert.equal(pluginPatch.status, 0)
    assert.match(pluginPatch.stdout, /@rivus\/dsh-estela \(\.changeset\/plugin-fix\.md\)/)
  })

  it('requires only @rivus/estela when only a non-plugin section changes', () => {
    const { repo, base } = createFixtureRepo()
    const editedDoc = FIXTURE_BASE.replace('| `estela` | `[session]` |', '| `estela` | `[session]` | `--mcp` |')
    commitChange(repo, { [INTERFACE]: editedDoc })

    const noChangeset = runCheck(repo, base)
    assert.equal(noChangeset.status, 1)
    assert.match(noChangeset.stderr, /@rivus\/estela/)
    assert.doesNotMatch(noChangeset.stderr, /@rivus\/dsh-estela/)

    commitChange(repo, {
      '.changeset/plugin-only.md': '---\n"@rivus/dsh-estela": patch\n---\n\nPlugin fix.\n',
    })
    const pluginOnly = runCheck(repo, base)
    assert.equal(pluginOnly.status, 1)
    assert.match(pluginOnly.stderr, /@rivus\/estela/)

    commitChange(repo, {
      '.changeset/cli-fix.md': '---\n"@rivus/estela": patch\n---\n\nUpdate CLI table.\n',
    })
    const cliPatch = runCheck(repo, base)
    assert.equal(cliPatch.status, 0)
    assert.match(cliPatch.stdout, /@rivus\/estela \(\.changeset\/cli-fix\.md\)/)
  })

  it('requires both @rivus/estela and @rivus/dsh-estela when both the plugin section and another section change', () => {
    const { repo, base } = createFixtureRepo()
    const editedDoc = FIXTURE_BASE.replace(
      '- **OTLP export.** Experimental mapping.',
      '- **OTLP export.** Updated experimental mapping.',
    ).replace('`ESTELA_REDACT=0` disables redaction.', '`ESTELA_REDACT=0` disables plugin redaction.')
    commitChange(repo, { [INTERFACE]: editedDoc })

    commitChange(repo, {
      '.changeset/cli-only.md': '---\n"@rivus/estela": patch\n---\n\nUpdate OTLP note.\n',
    })
    const missingPlugin = runCheck(repo, base)
    assert.equal(missingPlugin.status, 1)
    assert.match(missingPlugin.stderr, /@rivus\/dsh-estela/)
    assert.doesNotMatch(missingPlugin.stderr, /releases @rivus\/estela/)

    commitChange(repo, {
      '.changeset/plugin-fix.md': '---\n"@rivus/dsh-estela": minor\n---\n\nUpdate plugin redaction note.\n',
    })
    const separateChangesets = runCheck(repo, base)
    assert.equal(separateChangesets.status, 0)
    assert.match(separateChangesets.stdout, /@rivus\/estela \(\.changeset\/cli-only\.md\)/)
    assert.match(separateChangesets.stdout, /@rivus\/dsh-estela \(\.changeset\/plugin-fix\.md\)/)

    // Single changeset releasing both packages also passes.
    const second = createFixtureRepo()
    commitChange(second.repo, {
      [INTERFACE]: editedDoc,
      '.changeset/both.md': '---\n"@rivus/estela": patch\n"@rivus/dsh-estela": patch\n---\n\nUpdate both.\n',
    })
    const combined = runCheck(second.repo, second.base)
    assert.equal(combined.status, 0)
    assert.match(combined.stdout, /@rivus\/estela \(\.changeset\/both\.md\)/)
    assert.match(combined.stdout, /@rivus\/dsh-estela \(\.changeset\/both\.md\)/)
  })

  it('classifies adding or deleting plugin lines, fenced comments, subheadings, and unchanged files accurately', () => {
    // Unchanged public-interface.md exits 0 with no changeset.
    const unchanged = createFixtureRepo()
    commitChange(unchanged.repo, { 'README.md': '# Hello\n' })
    const unchangedRes = runCheck(unchanged.repo, unchanged.base)
    assert.equal(unchangedRes.status, 0)
    assert.match(unchangedRes.stdout, /unchanged/)

    // Adding a brand-new plugin section with a leading blank separator line requires only @rivus/dsh-estela.
    const added = createFixtureRepo(FIXTURE_WITHOUT_PLUGIN)
    const withPlugin = FIXTURE_WITHOUT_PLUGIN.replace(
      '## Experimental',
      '### dsh plugin (`@rivus/dsh-estela`)\n\nNew plugin section.\n\n## Experimental',
    )
    commitChange(added.repo, {
      [INTERFACE]: withPlugin,
      '.changeset/add-plugin.md': '---\n"@rivus/dsh-estela": minor\n---\n\nDocument the dsh plugin.\n',
    })
    assert.equal(runCheck(added.repo, added.base).status, 0)

    // Deleting a line inside the plugin section requires only @rivus/dsh-estela (uses old file headings).
    const deleted = createFixtureRepo()
    const withoutSubheadingLine = FIXTURE_BASE.replace('`ESTELA_REDACT=0` disables redaction.\n', '')
    commitChange(deleted.repo, {
      [INTERFACE]: withoutSubheadingLine,
      '.changeset/del-plugin.md': '---\n"@rivus/dsh-estela": minor\n---\n\nRemove plugin redaction note.\n',
    })
    assert.equal(runCheck(deleted.repo, deleted.base).status, 0)

    // Editing a line right after a fenced `# comment` inside the plugin section still maps to @rivus/dsh-estela.
    const fenceDiff = '@@ -17,1 +17,1 @@\n'
    assert.deepEqual(requiredPackages(FIXTURE_BASE, FIXTURE_BASE, fenceDiff), ['@rivus/dsh-estela'])

    // Editing `## Experimental` right after the plugin section maps back to @rivus/estela.
    const expLine = FIXTURE_BASE.split('\n').findIndex(line => line.startsWith('- **OTLP')) + 1
    assert.deepEqual(requiredPackages(FIXTURE_BASE, FIXTURE_BASE, `@@ -${expLine},1 +${expLine},1 @@\n`), [
      '@rivus/estela',
    ])

    // Multi-package changeset front matter parser reads every package entry.
    const parsed = bumpsOf('---\n"@rivus/estela": patch\n"@rivus/dsh-estela": minor\n---\n')
    assert.equal(parsed.get('@rivus/estela'), 'patch')
    assert.equal(parsed.get('@rivus/dsh-estela'), 'minor')
  })
})
