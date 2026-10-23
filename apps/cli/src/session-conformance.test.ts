import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { projectTurns } from '@rivus/agent-trace-kernel'
import { builtinAdapters } from './session-adapters.ts'
import {
  oversizedSession,
  sessionAdapterConformance,
  type ConformanceSession,
  type SessionAdapterFixtures,
} from '@rivus/agent-kit/testing'
import { afterAll, describe, expect, it } from 'vite-plus/test'
import { loadSession } from './session.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')
const fixturesOf = (agent: string): string => join(repo, 'fixtures/sessions', agent, 'conformance')
const platform = createNodePlatform()

/** Absolute paths for the session file and its side files. */
function sessionsOf(root: string, sessions: ConformanceSession[]): ConformanceSession[] {
  return sessions.map(session => ({
    ...session,
    path: join(root, session.path),
    ...(session.files ? { files: session.files.map(file => join(root, file)) } : {}),
  }))
}

const CLAUDE: ConformanceSession[] = [
  { path: 'plain/session.jsonl', records: 7, capabilities: ['requests', 'usage', 'durations', 'reasoning', 'hooks'] },
  { path: 'compaction/session.jsonl', records: 7, capabilities: ['compaction', 'compactionTokens'] },
  {
    path: 'subagent/session.jsonl',
    files: ['subagent/session.jsonl', 'subagent/session/subagents/agent-helper.jsonl'],
    records: 5,
    capabilities: ['subagents'],
  },
  { path: 'unknown-type/session.jsonl', records: 5, capabilities: [] },
  {
    path: 'regroup/session.jsonl',
    files: ['regroup/session.jsonl', 'regroup/session/subagents/workflows/wf-demo/agent-nested.jsonl'],
    records: 14,
    capabilities: ['requests', 'usage', 'subagents'],
  },
  {
    path: 'prompt-snapshot/session.jsonl',
    files: ['prompt-snapshot/session.jsonl', 'prompt-snapshot/session/subagents/agent-worker.jsonl'],
    records: 13,
    capabilities: ['requests', 'usage', 'subagents', 'systemPrompt', 'toolSchemas'],
  },
  { path: 'host-context/session.jsonl', records: 6, capabilities: [] },
]

const CODEX: ConformanceSession[] = [
  {
    path: 'rollout-plain.jsonl',
    records: 14,
    capabilities: ['requests', 'usage', 'durations', 'reasoning', 'systemPrompt'],
  },
  { path: 'rollout-token-count.jsonl', records: 14, capabilities: ['requests', 'usage'] },
  { path: 'rollout-compaction.jsonl', records: 11, capabilities: ['compaction', 'subagents'] },
  { path: 'rollout-subagent.jsonl', records: 9, capabilities: ['subagents'] },
  { path: 'rollout-unknown.jsonl', records: 6, capabilities: [] },
]

const GROK: ConformanceSession[] = [
  {
    path: 'plain/updates.jsonl',
    records: 9,
    capabilities: ['requests', 'usage', 'durations', 'reasoning', 'hooks', 'systemPrompt', 'toolSchemas'],
  },
  { path: 'compaction/updates.jsonl', records: 4, capabilities: ['compaction', 'compactionTokens'] },
  { path: 'subagent/updates.jsonl', records: 6, capabilities: ['subagents'] },
  { path: 'unknown-type/updates.jsonl', records: 1, capabilities: [] },
]

/** The oversized line each old conformance suite used, one temp root per adapter so a discover run lists only its own file. */
const OVERSIZED_LINES: Record<string, string> = {
  'claude-code': '{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"x"}}',
  codex:
    '{"timestamp":"2026-01-01T00:00:00.000Z","type":"session_meta","payload":{"session_id":"big","cwd":"/work/app"}}',
  grok: '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"x"}}}}',
}
const overRoots: string[] = []
function oversizedOf(agent: string): SessionAdapterFixtures['oversized'] {
  const root = mkdtempSync(join(tmpdir(), `at-conformance-${agent}-`))
  overRoots.push(root)
  // The name each adapter's discover lists: Claude Code takes any *.jsonl, Codex its rollout
  // names, Grok its updates.jsonl.
  const name = agent === 'codex' ? 'rollout-over.jsonl' : agent === 'grok' ? 'updates.jsonl' : 'session.jsonl'
  const file = join(root, name)
  writeFileSync(file, oversizedSession(OVERSIZED_LINES[agent]!))
  return { root, file }
}
afterAll(() => {
  for (const root of overRoots) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('session adapter conformance', () => {
  for (const [agent, adapter, sessions] of [
    ['claude-code', builtinAdapters['claude-code']!, CLAUDE],
    ['codex', builtinAdapters.codex!, CODEX],
    ['grok', builtinAdapters.grok!, GROK],
  ] as const) {
    const fixtures: SessionAdapterFixtures = {
      platform,
      root: fixturesOf(agent),
      sessions: sessionsOf(fixturesOf(agent), sessions),
      oversized: oversizedOf(agent),
    }
    describe(`${agent} conformance`, () => {
      // The kit's runner contract, as its own tests wire it: the check brings its title and
      // its assertions, and a failure rejects with the kit's message.
      for (const { name, run } of sessionAdapterConformance(adapter, fixtures)) {
        it(`${agent} ${name}`, async () => {
          await expect(run()).resolves.toBeUndefined()
        })
      }
    })
  }
})

describe('unknown generations fail loud on the repo fixtures', () => {
  const cases: [string, string][] = [
    ['claude-code', 'fixtures/sessions/claude-code/unknown-generation/session.jsonl'],
    ['codex', 'fixtures/sessions/codex/unknown-generation/rollout-bad.jsonl'],
    ['grok', 'fixtures/sessions/grok/unknown-generation'],
  ]
  for (const [agent, relative] of cases) {
    it(`${agent} unknown generation`, async () => {
      await expect(loadSession({ path: join(repo, relative) }, { platform })).rejects.toThrow(
        'unknown format generation',
      )
    })
  }
})

describe('claude-code host context stays in its own turn', () => {
  it('starts the turn at the record and points promptEventId at the user text', async () => {
    const trace = await loadSession(
      { path: join(repo, 'fixtures/sessions/claude-code/conformance/host-context/session.jsonl') },
      { platform },
    )
    const turns = projectTurns(trace)
    expect(turns).toHaveLength(3)
    const byId = new Map(trace.events.map(event => [event.id, event]))
    // Each turn holds its record's host blocks (IDE context, system reminder) beside the user text.
    expect(
      turns.map(turn =>
        turn.eventIds
          .map(id => byId.get(id)!)
          .filter(event => event.kind === 'user')
          .map(event => event.payload.text ?? ''),
      ),
    ).toEqual([
      ['Run the tests'],
      ['<ide_opened_file>/work/app/src/index.ts</ide_opened_file>', 'Fix this file'],
      ['<system-reminder>Lint failed: unused import.</system-reminder>', 'Now rename it'],
    ])
    const [first, ide, reminder] = turns.map(turn => byId.get(turn.promptEventId!)!)
    expect(first?.payload.text).toBe('Run the tests')
    expect(ide?.payload.text).toBe('Fix this file')
    expect(reminder?.payload.text).toBe('Now rename it')
    // The host block opens its record's turn and is marked injected.
    expect(byId.get(turns[1]!.eventIds[0]!)?.payload.injected).toBe(true)
    expect(byId.get(turns[2]!.eventIds[0]!)?.payload.injected).toBe(true)
  })
})
