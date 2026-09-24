import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Synthetic sessions only: every file is copied from the hosts' `fixtures/conformance` folders.
export interface FixtureHome {
  home: string
  /** `XDG_CACHE_HOME` for the session index, inside the temp dir. */
  cache: string
  claudePlain: string
}

const CLAUDE = ['plain', 'compaction', 'subagent']
const CODEX = ['plain', 'compaction', 'token-count']
const GROK = ['plain', 'compaction']

/** Builds `<root>/home` with Claude Code, Codex, and Grok sessions in their default locations. */
export async function buildFixtureHome(root: string, repo: string): Promise<FixtureHome> {
  const home = join(root, 'home')
  const cache = join(root, 'cache')
  const fixtures = (host: string) => join(repo, 'packages', `host-${host}`, 'fixtures/conformance')
  for (const name of CLAUDE)
    await cp(join(fixtures('claude-code'), name), join(home, '.claude/projects', `app-${name}`), { recursive: true })
  const codex = join(home, '.codex/sessions/2026/01/01')
  await mkdir(codex, { recursive: true })
  for (const name of CODEX)
    await cp(join(fixtures('codex'), `rollout-${name}.jsonl`), join(codex, `rollout-${name}.jsonl`))
  for (const name of GROK)
    await cp(join(fixtures('grok'), name), join(home, '.grok/sessions/work-app', name), { recursive: true })
  await mkdir(cache, { recursive: true })
  return { home, cache, claudePlain: join(home, '.claude/projects/app-plain/session.jsonl') }
}
