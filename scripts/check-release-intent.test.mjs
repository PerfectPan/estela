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

const FIXTURE_CLI_ONLY_NO_TRAILING_BLANK = `# Public interface and compatibility

## Covered

### Command line

| Command | Argument |
|---|---|
| \`estela\` | \`[session]\` |
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
  if (initialDoc) {
    writeRepoFile(repo, INTERFACE, initialDoc)
  } else {
    writeRepoFile(repo, 'README.md', '# Initial\n')
  }
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

  it('parses changeset front matter with Changesets: ignores empty front matter body examples and accepts quoted values with comments', () => {
    const { repo, base } = createFixtureRepo()
    const editedDoc = FIXTURE_BASE.replace(
      'Install with `dsh plugin add @rivus/dsh-estela`.',
      'Install with `dsh plugin add @rivus/dsh-estela` (updated).',
    )
    // Empty front matter followed by a body example and a Markdown rule must not count as a release.
    commitChange(repo, {
      [INTERFACE]: editedDoc,
      '.changeset/empty-with-example.md': '---\n---\n\nExample:\n"@rivus/dsh-estela": patch\n---\n',
    })
    const emptyRes = runCheck(repo, base)
    assert.equal(emptyRes.status, 1)
    assert.match(emptyRes.stderr, /@rivus\/dsh-estela/)

    // Quoted YAML scalar with trailing inline comment is accepted by Changesets and must pass here.
    commitChange(repo, {
      '.changeset/quoted-comment.md': '---\n"@rivus/dsh-estela": "patch" # compatibility\n---\n\nPlugin fix.\n',
    })
    const quotedRes = runCheck(repo, base)
    assert.equal(quotedRes.status, 0)
    assert.match(quotedRes.stdout, /@rivus\/dsh-estela \(\.changeset\/quoted-comment\.md\)/)

    const parsed = bumpsOf('---\n"@rivus/estela": "patch" # cli\n"@rivus/dsh-estela": minor\n---\n')
    assert.equal(parsed.get('@rivus/estela'), 'patch')
    assert.equal(parsed.get('@rivus/dsh-estela'), 'minor')
    assert.equal(bumpsOf('---\n---\n\n"@rivus/dsh-estela": patch\n---\n').size, 0)
  })

  it('scopes the plugin section strictly to the exact plugin heading and preserves its level across subheadings mentioning the package', () => {
    // 1. A heading outside the plugin section mentioning `@rivus/dsh-estela` does not start the plugin section.
    const outside = createFixtureRepo()
    const withNotCoveredHeading = `${FIXTURE_BASE}\n### Internals of @rivus/dsh-estela\n\nInternal channel notes.\n`
    commitChange(outside.repo, {
      [INTERFACE]: withNotCoveredHeading,
      '.changeset/cli-note.md': '---\n"@rivus/estela": patch\n---\n\nClarify not-covered notes.\n',
    })
    const outsideWithCli = runCheck(outside.repo, outside.base)
    assert.equal(outsideWithCli.status, 0)
    assert.match(outsideWithCli.stdout, /@rivus\/estela \(\.changeset\/cli-note\.md\)/)

    const outsideOnlyPlugin = createFixtureRepo()
    commitChange(outsideOnlyPlugin.repo, {
      [INTERFACE]: withNotCoveredHeading,
      '.changeset/plugin-only.md': '---\n"@rivus/dsh-estela": patch\n---\n\nWrong package.\n',
    })
    assert.equal(runCheck(outsideOnlyPlugin.repo, outsideOnlyPlugin.base).status, 1)

    // 2. A subheading inside the plugin section mentioning `@rivus/dsh-estela` must not narrow the plugin section's level,
    //    so a sibling subheading after it (`#### Settings`) remains owned by `@rivus/dsh-estela`.
    const nestedBase = FIXTURE_BASE.replace(
      '#### Environment\n\n`ESTELA_REDACT=0` disables redaction.',
      '#### Install @rivus/dsh-estela\n\nRun install.\n\n#### Settings\n\nNo settings.',
    )
    const nested = createFixtureRepo(nestedBase)
    commitChange(nested.repo, {
      [INTERFACE]: nestedBase.replace('No settings.', 'No user settings.'),
      '.changeset/plugin-settings.md': '---\n"@rivus/dsh-estela": patch\n---\n\nClarify plugin settings.\n',
    })
    const nestedRes = runCheck(nested.repo, nested.base)
    assert.equal(nestedRes.status, 0)
    assert.match(nestedRes.stdout, /@rivus\/dsh-estela \(\.changeset\/plugin-settings\.md\)/)
  })

  it('enforces changesets when public-interface.md is deleted or renamed, and emits no git stderr when newly added', () => {
    // Whole-file delete of a doc containing both CLI and plugin sections requires both packages.
    const deleted = createFixtureRepo()
    rmSync(join(deleted.repo, INTERFACE))
    git(deleted.repo, 'add', '-A')
    git(deleted.repo, 'commit', '-m', 'delete interface doc')

    const deleteNoChangeset = runCheck(deleted.repo, deleted.base)
    assert.equal(deleteNoChangeset.status, 1)
    assert.match(deleteNoChangeset.stderr, /@rivus\/estela, @rivus\/dsh-estela/)

    commitChange(deleted.repo, {
      '.changeset/remove-both.md': '---\n"@rivus/estela": minor\n"@rivus/dsh-estela": minor\n---\n\nRemove doc.\n',
    })
    assert.equal(runCheck(deleted.repo, deleted.base).status, 0)

    // Whole-file rename cannot bypass the gate either.
    const renamed = createFixtureRepo()
    git(renamed.repo, 'mv', INTERFACE, 'docs/reference/moved-interface.md')
    git(renamed.repo, 'commit', '-m', 'rename interface doc')

    const renameNoChangeset = runCheck(renamed.repo, renamed.base)
    assert.equal(renameNoChangeset.status, 1)
    assert.match(renameNoChangeset.stderr, /@rivus\/estela, @rivus\/dsh-estela/)

    commitChange(renamed.repo, {
      '.changeset/rename-both.md': '---\n"@rivus/estela": minor\n"@rivus/dsh-estela": minor\n---\n\nRename doc.\n',
    })
    assert.equal(runCheck(renamed.repo, renamed.base).status, 0)

    // Whole-file add must not invoke `git show` on the missing base path (zero stderr).
    const added = createFixtureRepo('')
    commitChange(added.repo, {
      [INTERFACE]: FIXTURE_BASE,
      '.changeset/add-both.md': '---\n"@rivus/estela": minor\n"@rivus/dsh-estela": minor\n---\n\nAdd doc.\n',
    })
    const addRes = runCheck(added.repo, added.base)
    assert.equal(addRes.status, 0)
    assert.equal(addRes.stderr, '')
  })

  it('ignores a newly added leading blank separator line before the plugin heading, and uses old-file headings when deleting the whole plugin section', () => {
    // 1. Newly added blank separator line at the end of the CLI section right before a newly added plugin section:
    //    the hunk contains a new blank line (whose heading in HEAD is `### Command line`) plus the new plugin section.
    //    Ignoring blank lines in a non-blank hunk means only `@rivus/dsh-estela` is required.
    const appended = createFixtureRepo(FIXTURE_CLI_ONLY_NO_TRAILING_BLANK)
    const withAppendedPlugin = `${FIXTURE_CLI_ONLY_NO_TRAILING_BLANK}\n### dsh plugin (\`@rivus/dsh-estela\`)\n\nNew plugin section.\n`
    commitChange(appended.repo, {
      [INTERFACE]: withAppendedPlugin,
      '.changeset/add-plugin.md': '---\n"@rivus/dsh-estela": minor\n---\n\nDocument the dsh plugin.\n',
    })
    const appendRes = runCheck(appended.repo, appended.base)
    assert.equal(appendRes.status, 0, appendRes.stderr)
    assert.match(appendRes.stdout, /@rivus\/dsh-estela \(\.changeset\/add-plugin\.md\)/)

    // 2. Deleting the entire plugin section causes `## Experimental` (owned by `@rivus/estela`) to shift up
    //    into the deleted line numbers in HEAD. Checking old-file headings classifies the deletion as plugin-only.
    const removed = createFixtureRepo()
    const pluginStart = FIXTURE_BASE.indexOf('### dsh plugin (`@rivus/dsh-estela`)')
    const experimentalStart = FIXTURE_BASE.indexOf('## Experimental')
    const withoutPluginSection = `${FIXTURE_BASE.slice(0, pluginStart)}${FIXTURE_BASE.slice(experimentalStart)}`
    commitChange(removed.repo, {
      [INTERFACE]: withoutPluginSection,
      '.changeset/remove-plugin.md': '---\n"@rivus/dsh-estela": minor\n---\n\nRemove plugin section.\n',
    })
    const removeRes = runCheck(removed.repo, removed.base)
    assert.equal(removeRes.status, 0, removeRes.stderr)
    assert.match(removeRes.stdout, /@rivus\/dsh-estela \(\.changeset\/remove-plugin\.md\)/)

    // Unchanged public-interface.md exits 0 with no changeset, and fenced `#` comments stay in plugin section.
    const unchanged = createFixtureRepo()
    commitChange(unchanged.repo, { 'README.md': '# Hello\n' })
    assert.equal(runCheck(unchanged.repo, unchanged.base).status, 0)
    assert.deepEqual(requiredPackages(FIXTURE_BASE, FIXTURE_BASE, '@@ -17,1 +17,1 @@\n'), ['@rivus/dsh-estela'])
    const expLine = FIXTURE_BASE.split('\n').findIndex(line => line.startsWith('- **OTLP')) + 1
    assert.deepEqual(requiredPackages(FIXTURE_BASE, FIXTURE_BASE, `@@ -${expLine},1 +${expLine},1 @@\n`), [
      '@rivus/estela',
    ])
  })
})
