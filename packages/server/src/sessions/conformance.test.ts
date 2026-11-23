import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { projectTurns, reconstruct } from '@rivus/estela-kernel'
import { builtinAdapters, keepsSessionsInDatabase } from './adapters.ts'
import {
  oversizedSession,
  sessionAdapterConformance,
  type ConformanceSession,
  type SessionAdapterFixtures,
} from '@rivus/agent-kit/testing'
import { afterAll, describe, expect, it } from 'vite-plus/test'
import { loadSession } from './load-session.ts'
import { toKitPath } from './session-target.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../../..')
/** A path in the form the server hands the kit: the kit's conformance runner calls the adapters directly. */
const kitJoin = (...parts: string[]): string => toKitPath(join(...parts))
const fixturesOf = (agent: string): string => kitJoin(repo, 'fixtures/sessions', agent, 'conformance')
const platform = createNodePlatform()

/** Absolute paths for the session file and its side files. */
function sessionsOf(root: string, sessions: ConformanceSession[]): ConformanceSession[] {
  return sessions.map(session => ({
    ...session,
    path: kitJoin(root, session.path),
    ...(session.files ? { files: session.files.map(file => kitJoin(root, file)) } : {}),
    ...(session.recordKeys
      ? {
          recordKeys: session.recordKeys.map(key => {
            const at = key.indexOf('\0')
            return `${kitJoin(root, key.slice(0, at))}${key.slice(at)}`
          }),
        }
      : {}),
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
  { path: 'host-context/session.jsonl', records: 8, capabilities: [] },
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
  {
    path: 'rollout-features.jsonl',
    records: 14,
    capabilities: [
      'requests',
      'usage',
      'durations',
      'compaction',
      'compactionTokens',
      'hooks',
      'systemPrompt',
      'toolSchemas',
    ],
  },
]

const GEMINI: ConformanceSession[] = [
  { path: 'plain/chats/session-1.jsonl', records: 9, capabilities: ['requests', 'usage', 'reasoning'] },
  { path: 'compaction/chats/session-1.jsonl', records: 6, capabilities: ['compaction', 'compactionTokens'] },
  { path: 'message-update/chats/session-1.jsonl', records: 5, capabilities: ['requests', 'usage'] },
  { path: 'unknown-type/chats/session-1.jsonl', records: 2, capabilities: [] },
]

const PI: ConformanceSession[] = [
  { path: 'plain/session.jsonl', records: 8, capabilities: ['requests', 'usage', 'reasoning'] },
  {
    path: 'compaction/session.jsonl',
    records: 8,
    capabilities: ['requests', 'usage', 'compaction', 'compactionTokens'],
  },
  { path: 'unknown-type/session.jsonl', records: 3, capabilities: [] },
]

const DSH: ConformanceSession[] = [
  {
    path: 'plain/session.v4.jsonl',
    records: 9,
    capabilities: ['requests', 'usage', 'reasoning', 'systemPrompt', 'toolSchemas'],
  },
  {
    // The same session compressed, as DeepSeek Harness writes it. A compressed log has no lines to
    // count on disk, so the decompressed records are named by the line each one occupies.
    path: 'plain/session.v4.jsonl.zstd',
    records: 9,
    recordKeys: Array.from({ length: 9 }, (_, index) => `plain/session.v4.jsonl.zstd\0${index + 1}`),
    capabilities: ['requests', 'usage', 'reasoning', 'systemPrompt', 'toolSchemas'],
  },
  {
    path: 'timed/session.v4.jsonl',
    records: 10,
    capabilities: ['requests', 'usage', 'durations', 'reasoning'],
  },
  {
    // Its local subagents run in sessions of their own (`spawn-child`, `fork-child`), attached as lanes.
    path: 'parent/session.v4.jsonl',
    files: ['parent/session.v4.jsonl', 'spawn-child/session.v4.jsonl', 'fork-child/session.v4.jsonl'],
    records: 19,
    capabilities: ['requests', 'usage', 'subagents'],
  },
  { path: 'hooks/session.v4.jsonl', records: 5, capabilities: ['requests', 'usage', 'hooks'] },
  {
    path: 'compaction/session.v4.jsonl',
    records: 10,
    capabilities: ['requests', 'usage', 'compaction', 'compactionTokens', 'systemPrompt'],
  },
  { path: 'unknown-type/session.v4.jsonl', records: 3, capabilities: [] },
]

const OPENCODE: ConformanceSession[] = [
  {
    path: 'opencode.db',
    sessionId: 'ses_smoke',
    records: 8,
    recordKeys: Array.from({ length: 8 }, (_, index) => `opencode.db\0${index + 1}`),
    capabilities: ['requests', 'usage', 'reasoning'],
  },
  // The kit's own conformance sessions, merged into the same database.
  {
    path: 'opencode.db',
    sessionId: 'ses_features',
    records: 4,
    recordKeys: Array.from({ length: 4 }, (_, index) => `opencode.db\0${index + 1}`),
    capabilities: ['compaction', 'compactionTokens', 'subagents'],
    compactionShadowing: false,
  },
  {
    path: 'opencode.db',
    sessionId: 'ses_plain',
    records: 8,
    // A part whose message is missing is a record too, so the keys outnumber the records by one.
    recordKeys: Array.from({ length: 9 }, (_, index) => `opencode.db\0${index + 1}`),
    capabilities: ['requests', 'usage', 'durations', 'reasoning'],
  },
  {
    path: 'opencode.db',
    sessionId: 'ses_unknown',
    records: 5,
    recordKeys: Array.from({ length: 5 }, (_, index) => `opencode.db\0${index + 1}`),
    capabilities: ['requests', 'usage', 'durations'],
  },
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

// The five agents below come with the fixtures their kit reader's own conformance suite uses, copied as they are.

const QODER: ConformanceSession[] = [
  {
    path: 'projects/-u-me-work/s-1.jsonl',
    records: 6,
    capabilities: ['requests', 'usage', 'reasoning', 'compaction', 'subagents'],
  },
]

const KIMI: ConformanceSession[] = [
  {
    path: 'sessions/wd_demo_111111111111/session_demo-1/agents/main/wire.jsonl',
    records: 21,
    capabilities: ['requests', 'usage', 'durations', 'reasoning', 'systemPrompt', 'toolSchemas'],
  },
  {
    path: 'sessions/wd_demo_111111111111/session_demo-2/agents/main/wire.jsonl',
    records: 19,
    capabilities: ['requests', 'usage', 'durations', 'systemPrompt'],
  },
  {
    path: 'sessions/wd_demo_111111111111/session_demo-3/agents/main/wire.jsonl',
    files: [
      'sessions/wd_demo_111111111111/session_demo-3/agents/main/wire.jsonl',
      'sessions/wd_demo_111111111111/session_demo-3/agents/sub_1/wire.jsonl',
    ],
    records: 15,
    capabilities: [
      'requests',
      'usage',
      'durations',
      'reasoning',
      'compaction',
      'compactionTokens',
      'subagents',
      'hooks',
      'systemPrompt',
    ],
  },
]

const AGY: ConformanceSession[] = [
  {
    // Discovery lists the full transcript when the folder has both.
    path: 'antigravity-cli/brain/conv-1/.system_generated/logs/transcript_full.jsonl',
    records: 6,
    capabilities: ['requests', 'usage', 'reasoning', 'compaction'],
  },
]

/** The kit's own conformance sessions, one database row per record: the session, then each message and its parts. */
const ZCODE: ConformanceSession[] = [
  {
    path: 'cli/db/db.sqlite',
    sessionId: 'ses_fork',
    records: 9,
    recordKeys: Array.from({ length: 9 }, (_, index) => `cli/db/db.sqlite\0${index + 1}`),
    capabilities: ['requests', 'usage', 'durations', 'reasoning'],
  },
  {
    path: 'cli/db/db.sqlite',
    sessionId: 'ses_features',
    records: 5,
    recordKeys: Array.from({ length: 5 }, (_, index) => `cli/db/db.sqlite\0${index + 1}`),
    capabilities: ['compaction', 'compactionTokens', 'subagents', 'systemPrompt'],
    compactionShadowing: false,
  },
  {
    path: 'cli/db/db.sqlite',
    sessionId: 'ses_plain',
    records: 9,
    recordKeys: Array.from({ length: 9 }, (_, index) => `cli/db/db.sqlite\0${index + 1}`),
    capabilities: ['requests', 'usage', 'durations', 'reasoning'],
  },
  {
    path: 'cli/db/db.sqlite',
    sessionId: 'ses_unknown',
    records: 5,
    recordKeys: Array.from({ length: 5 }, (_, index) => `cli/db/db.sqlite\0${index + 1}`),
    capabilities: ['requests', 'usage', 'durations'],
  },
  {
    path: 'cli/db/db.sqlite',
    sessionId: 'ses_order',
    records: 4,
    recordKeys: Array.from({ length: 5 }, (_, index) => `cli/db/db.sqlite\0${index + 1}`),
    capabilities: ['requests'],
  },
  {
    path: 'cli/db/db.sqlite',
    sessionId: 'ses_snapshot',
    records: 7,
    recordKeys: Array.from({ length: 7 }, (_, index) => `cli/db/db.sqlite\0${index + 1}`),
    capabilities: ['systemPrompt'],
  },
]

/** The kit's runner checks that each listed key is covered, so every row is listed: two messages, then two usage rows. */
const DIM: ConformanceSession[] = [
  {
    path: 'dimcode.sqlite',
    sessionId: 's1',
    records: 4,
    recordKeys: Array.from({ length: 4 }, (_, index) => `dimcode.sqlite\0${index + 1}`),
    capabilities: ['requests', 'usage', 'durations', 'reasoning'],
  },
]

/**
 * Where discovery starts, below an agent's conformance folder, for the agents whose root is not the folder itself:
 * the folder their home rule names.
 */
const DISCOVERY_ROOTS: Partial<Record<string, string>> = {
  qoder: 'projects',
  kimi: 'sessions',
  agy: 'antigravity-cli/brain',
}

/** The oversized line each old conformance suite used, one temp root per adapter so a discover run lists only its own file. */
const OVERSIZED_LINES: Record<string, string | undefined> = {
  'claude-code': '{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"x"}}',
  codex:
    '{"timestamp":"2026-01-01T00:00:00.000Z","type":"session_meta","payload":{"session_id":"big","cwd":"/work/app"}}',
  grok: '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"x"}}}}',
  pi: '{"type":"message","id":"big","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"x"}}',
  dsh: '{"type":"user/message","seq":1,"time":1767225600000,"data":{"role":"user","content":[{"type":"text","text":"x"}],"source":{"kind":"user"}}}',
  opencode: undefined,
  'gemini-cli': '{"id":"u-oversized","type":"user","content":"x","timestamp":"2026-01-01T00:00:00.000Z"}',
}
const overRoots: string[] = []
function oversizedOf(agent: string): SessionAdapterFixtures['oversized'] {
  const line = OVERSIZED_LINES[agent]
  if (line === undefined) {
    return undefined
  }
  const root = toKitPath(mkdtempSync(join(tmpdir(), `at-conformance-${agent}-`)))
  overRoots.push(root)
  // The name each adapter's discover lists.
  const name =
    agent === 'codex'
      ? 'rollout-over.jsonl'
      : agent === 'grok'
        ? 'updates.jsonl'
        : agent === 'dsh'
          ? 'session.v4.jsonl'
          : agent === 'gemini-cli'
            ? 'session-over.jsonl'
            : 'session.jsonl'
  const file = kitJoin(root, name)
  writeFileSync(file, oversizedSession(line))
  return { root, file }
}
afterAll(() => {
  for (const root of overRoots) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** Every built-in adapter with its fixture sessions. */
const SUITES = [
  ['claude-code', CLAUDE],
  ['codex', CODEX],
  ['grok', GROK],
  ['pi', PI],
  ['gemini-cli', GEMINI],
  ['dsh', DSH],
  ['opencode', OPENCODE],
  ['qoder', QODER],
  ['kimi', KIMI],
  ['agy', AGY],
  ['zcode', ZCODE],
  ['dim', DIM],
] as const

describe('session adapter conformance', () => {
  it('covers every built-in adapter', () => {
    expect(SUITES.map(([agent]) => agent).toSorted()).toEqual(Object.keys(builtinAdapters).toSorted())
  })
  for (const [agent, sessions] of SUITES) {
    const adapter = builtinAdapters[agent]!
    const oversized = oversizedOf(agent)
    const subdirectory = DISCOVERY_ROOTS[agent]
    const fixtures: SessionAdapterFixtures = {
      platform,
      root: subdirectory === undefined ? fixturesOf(agent) : kitJoin(fixturesOf(agent), subdirectory),
      sessions: sessionsOf(fixturesOf(agent), sessions),
      ...(oversized === undefined ? {} : { oversized }),
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

describe('database agents', () => {
  // The catalog's database rules (`keepsSessionsInDatabase`) are a list the kit does not supply, so a new reader
  // whose records are SQLite rows must be added to it.
  for (const [agent, sessions] of SUITES) {
    it(`${agent} is a database agent exactly when its records are SQLite rows`, async () => {
      const [first] = sessionsOf(fixturesOf(agent), [...sessions])
      const loaded = await builtinAdapters[agent]!.load(platform, {
        agent,
        path: first!.path,
        ...(first!.sessionId === undefined ? {} : { sessionId: first!.sessionId }),
      })
      expect(loaded.ok).toBe(true)
      const rows = loaded.ok && loaded.value.events.some(event => event.source.sqlite !== undefined)
      expect(rows).toBe(keepsSessionsInDatabase(agent))
    })
  }
})

describe('unknown generations fail loud on the repo fixtures', () => {
  const cases: [string, string][] = [
    ['claude-code', 'fixtures/sessions/claude-code/unknown-generation/session.jsonl'],
    ['codex', 'fixtures/sessions/codex/unknown-generation/rollout-bad.jsonl'],
    ['grok', 'fixtures/sessions/grok/unknown-generation'],
    ['pi', 'fixtures/sessions/pi/unknown-generation/session.jsonl'],
    ['dsh', 'fixtures/sessions/dsh/unknown-generation/session.v4.jsonl'],
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
  it('starts the turn at the record, keeps the tool result with its call, and matches the inspector', async () => {
    const trace = await loadSession(
      { path: join(repo, 'fixtures/sessions/claude-code/conformance/host-context/session.jsonl') },
      { platform },
    )
    const turns = projectTurns(trace)
    expect(turns).toHaveLength(4)
    // Full ledger: a record's host blocks (IDE context, system reminder) open their own
    // turn; the tool result stays with its call's turn, the user text starts the next.
    expect(turns.map(turn => turn.eventIds)).toEqual([
      ['u1', 'request:msg-1', 'a1'],
      ['u2', 'u2:1', 'request:msg-2', 'a2'],
      ['u3', 'u3:1', 'request:msg-3', 'a3', 'u4'],
      ['u4:1', 'request:msg-4', 'a4'],
    ])
    expect(turns.map(turn => turn.promptEventId)).toEqual(['u1', 'u2:1', 'u3:1', 'u4:1'])
    const byId = new Map(trace.events.map(event => [event.id, event]))
    // The host block opens its record's turn and is marked injected.
    expect(byId.get('u2')?.payload.injected).toBe(true)
    expect(byId.get('u3')?.payload.injected).toBe(true)
    // The inspector's current turn matches the ledger: the reminder record from 'a3',
    // and the tool result stays out of the turn its user text starts.
    const atCall = reconstruct(trace, 'a3')
    expect(atCall.slots?.find(slot => slot.name === 'currentTurn')?.eventIds).toEqual(['u3', 'u3:1', 'a3'])
    const atLast = reconstruct(trace, 'a4')
    expect(atLast.slots?.find(slot => slot.name === 'currentTurn')?.eventIds).toEqual(['u4:1', 'a4'])
    expect(atLast.slots?.find(slot => slot.name === 'messages')?.eventIds).toContain('u4')
  })
})
