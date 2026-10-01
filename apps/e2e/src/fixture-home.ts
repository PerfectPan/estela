import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Synthetic sessions only: copied from the hosts' fixture folders, or written here.
export interface FixtureHome {
  home: string
  claudePlain: string
  /** With `browser`: a Claude Code session with three requests, a compaction, and two after it (S5, S7). */
  claudeRising: string
  /** With `browser`: the same session under the home directory, naming it in every form a log does (S9). */
  claudeHomeCwd: string
  /** With `browser`: the rising session with prompt snapshots in the order Claude Code writes them (S7). */
  claudeSnapshot: string
  /** Sessions per host. */
  counts: Record<'claude-code' | 'codex' | 'grok', number>
}

export interface FixtureOptions {
  /** Leave out `~/.codex` (S3). */
  codex?: boolean
  /** The browser suite's extra sessions: an unknown record type, an unknown generation (S4), and the three generated ones. */
  browser?: boolean
}

const CLAUDE = ['plain', 'compaction', 'subagent']
const CODEX = ['plain', 'compaction', 'token-count']
const GROK = ['plain', 'compaction']

function line(record: Record<string, unknown>): string {
  return `${JSON.stringify({ sessionId: 's-rising', version: '2.0.0', ...record })}\n`
}

/**
 * Prompt snapshots in the shape and order Claude Code writes them: one with the system prompt
 * before the first prompt, and one with the system prompt and the tool list after the first request.
 */
function snapshot(uuid: string, timestamp: string, withTools: boolean): string {
  const tools = [{ name: 'Read', description: 'Read a file', schema: { name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } } }]
  return line({
    type: 'attachment',
    uuid,
    timestamp,
    attachment: { type: 'prompt_snapshot', systemPrompt: ['You are a test agent.'], ...(withTools ? { tools, cliPrefix: 'Test CLI prefix.' } : {}) },
  })
}

/**
 * A Claude Code session whose input tokens rise over three requests, drop after an automatic
 * compaction (pre 3,500, post 400), and rise again. `prompts` are extra user prompts at the end.
 * With `snapshots`, prompt snapshots record the system prompt before the first request and the tool list after it.
 */
export function risingSession(cwd: string, prompts: string[] = [], snapshots = false): string {
  let clock = 0
  const at = () => new Date(Date.UTC(2026, 0, 1) + 1000 * clock++).toISOString()
  const user = (uuid: string, content: string) => line({ type: 'user', uuid, timestamp: at(), cwd, message: { role: 'user', content } })
  const reply = (n: number, input: number) => line({
    type: 'assistant',
    uuid: `r-a${n}`,
    timestamp: at(),
    cwd,
    requestId: `req-r${n}`,
    message: { role: 'assistant', model: 'claude-test', id: `msg-r${n}`, stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: 10 }, content: [{ type: 'text', text: `Reply ${n}` }] },
  })
  return [
    ...(snapshots ? [snapshot('r-s1', at(), false)] : []),
    user('r-u1', 'Start the task'),
    reply(1, 1000),
    ...(snapshots ? [snapshot('r-s2', at(), true)] : []),
    user('r-u2', 'Keep going'),
    reply(2, 2000),
    user('r-u3', 'Keep this one'),
    reply(3, 3000),
    line({ type: 'system', subtype: 'compact_boundary', uuid: 'r-b1', timestamp: at(), compactMetadata: { trigger: 'auto', preTokens: 3500, postTokens: 400, durationMs: 50, preservedSegment: { headUuid: 'r-u3', anchorUuid: 'r-u3', tailUuid: 'r-a3' } } }),
    line({ type: 'user', uuid: 'r-sum', parentUuid: 'r-b1', timestamp: at(), isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary of the earlier conversation.' } }),
    user('r-u4', 'After the compaction'),
    reply(4, 600),
    user('r-u5', 'One more'),
    reply(5, 900),
    ...prompts.map((text, index) => user(`r-x${index}`, text)),
  ].join('')
}

/** Builds `home` with Claude Code, Codex, and Grok sessions in their default locations. */
export async function buildFixtureHome(home: string, repo: string, options: FixtureOptions = {}): Promise<FixtureHome> {
  const fixtures = (host: string) => join(repo, 'packages', `host-${host}`, 'fixtures/conformance')
  const projects = join(home, '.claude/projects')
  const claude = options.browser ? [...CLAUDE, 'unknown-type'] : CLAUDE
  for (const name of claude)
    await cp(join(fixtures('claude-code'), name), join(projects, `app-${name}`), { recursive: true })
  const claudeRising = join(projects, 'app-rising/session.jsonl')
  // Claude Code names a project folder after its cwd with every other character as `-`.
  const homeCwd = `${home}/work/app`
  const claudeHomeCwd = join(projects, homeCwd.replaceAll(/[^A-Za-z0-9]/g, '-'), 'session.jsonl')
  const claudeSnapshot = join(projects, 'app-snapshot/session.jsonl')
  if (options.browser) {
    // S4: records of a format generation the adapter does not know.
    await cp(join(repo, 'packages/host-claude-code/fixtures/unknown-generation'), join(projects, 'app-unknown-generation'), { recursive: true })
    await mkdir(join(claudeRising, '..'), { recursive: true })
    await writeFile(claudeRising, risingSession('/work/app'))
    await mkdir(join(claudeSnapshot, '..'), { recursive: true })
    await writeFile(claudeSnapshot, risingSession('/work/app', [], true))
    await mkdir(join(claudeHomeCwd, '..'), { recursive: true })
    await writeFile(claudeHomeCwd, risingSession(homeCwd, [
      `diff --git a${homeCwd}/src/a.ts b${homeCwd}/src/a.ts`,
      `Read ${homeCwd.slice(1)}/notes.md, relative to /`,
      `{"cwd":"${homeCwd.replaceAll('/', '\\/')}"}`,
      `open ${homeCwd.replaceAll('/', '%2F')} and ${homeCwd.toUpperCase()}`,
    ]))
  }
  if (options.codex !== false) {
    const codex = join(home, '.codex/sessions/2026/01/01')
    await mkdir(codex, { recursive: true })
    for (const name of CODEX)
      await cp(join(fixtures('codex'), `rollout-${name}.jsonl`), join(codex, `rollout-${name}.jsonl`))
  }
  for (const name of GROK)
    await cp(join(fixtures('grok'), name), join(home, '.grok/sessions/work-app', name), { recursive: true })
  return {
    home,
    claudePlain: join(projects, 'app-plain/session.jsonl'),
    claudeRising,
    claudeHomeCwd,
    claudeSnapshot,
    counts: { 'claude-code': claude.length + (options.browser ? 4 : 0), 'codex': options.codex === false ? 0 : CODEX.length, 'grok': GROK.length },
  }
}
