import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Synthetic sessions only: every file comes from the hosts' `fixtures/conformance` folders.
export interface E2eHomes {
  /** Claude Code, Codex, and Grok sessions in their default locations, one of them unreadable. */
  main: string
  /** The same without `~/.codex` (S3). */
  noCodex: string
  /** `XDG_CACHE_HOME` parent: each run gets its own cache below it. */
  cacheRoot: string
  sessions: {
    claudePlain: string
    claudeCompaction: string
    /** The compaction session with its working directory moved under the synthetic home (S9). */
    claudeHomeCwd: string
  }
  /** Sessions per host in `main`. */
  counts: Record<'claude-code' | 'codex' | 'grok', number>
}

const CLAUDE = ['plain', 'compaction', 'subagent', 'unknown-type']
const CODEX = ['plain', 'compaction', 'token-count']
const GROK = ['plain', 'compaction']

async function fillHome(home: string, repo: string, options: { codex: boolean }): Promise<void> {
  const fixtures = (host: string) => join(repo, 'packages', `host-${host}`, 'fixtures/conformance')
  for (const name of CLAUDE)
    await cp(join(fixtures('claude-code'), name), join(home, '.claude/projects', `app-${name}`), { recursive: true })
  // S4: records of a format generation the adapter does not know.
  await cp(join(repo, 'packages/host-claude-code/fixtures/unknown-generation'), join(home, '.claude/projects/app-unknown-generation'), { recursive: true })
  // A session that names the home directory, so the report's redaction has something to remove.
  const homeCwd = join(home, '.claude/projects/app-home-cwd')
  await mkdir(homeCwd, { recursive: true })
  const text = await readFile(join(fixtures('claude-code'), 'compaction/session.jsonl'), 'utf8')
  await writeFile(join(homeCwd, 'session.jsonl'), text.replaceAll('/work/app', `${home}/work/app`))
  if (options.codex) {
    const codex = join(home, '.codex/sessions/2026/01/01')
    await mkdir(codex, { recursive: true })
    for (const name of CODEX)
      await cp(join(fixtures('codex'), `rollout-${name}.jsonl`), join(codex, `rollout-${name}.jsonl`))
  }
  for (const name of GROK)
    await cp(join(fixtures('grok'), name), join(home, '.grok/sessions/work-app', name), { recursive: true })
}

export async function buildE2eHomes(root: string, repo: string): Promise<E2eHomes> {
  const main = join(root, 'home')
  const noCodex = join(root, 'home-no-codex')
  await fillHome(main, repo, { codex: true })
  await fillHome(noCodex, repo, { codex: false })
  const cacheRoot = join(root, 'cache')
  await mkdir(cacheRoot, { recursive: true })
  const projects = join(main, '.claude/projects')
  return {
    main,
    noCodex,
    cacheRoot,
    sessions: {
      claudePlain: join(projects, 'app-plain/session.jsonl'),
      claudeCompaction: join(projects, 'app-compaction/session.jsonl'),
      claudeHomeCwd: join(projects, 'app-home-cwd/session.jsonl'),
    },
    counts: { 'claude-code': CLAUDE.length + 2, 'codex': CODEX.length, 'grok': GROK.length },
  }
}
