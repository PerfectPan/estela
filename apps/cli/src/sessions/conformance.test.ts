import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { projectTurns, reconstruct } from '@rivus/agent-trace-kernel'
import { builtinAdapters } from './adapters.ts'
import {
  oversizedSession,
  sessionAdapterConformance,
  type ConformanceSession,
  type SessionAdapterFixtures,
} from '@rivus/agent-kit/testing'
import { afterAll, describe, expect, it } from 'vite-plus/test'
import { loadSession } from './load-session.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../../..')
const fixturesOf = (agent: string): string => join(repo, 'fixtures/sessions', agent, 'conformance')
const platform = createNodePlatform()

/** Absolute paths for the session file and its side files. */
function sessionsOf(root: string, sessions: ConformanceSession[]): ConformanceSession[] {
  return sessions.map(session => ({
    ...session,
    path: join(root, session.path),
    ...(session.files ? { files: session.files.map(file => join(root, file)) } : {}),
    ...(session.recordKeys
      ? {
          recordKeys: session.recordKeys.map(key => {
            const at = key.indexOf('\0')
            return `${join(root, key.slice(0, at))}${key.slice(at)}`
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
  const root = mkdtempSync(join(tmpdir(), `at-conformance-${agent}-`))
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
  const file = join(root, name)
  writeFileSync(file, oversizedSession(line))
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
    ['pi', builtinAdapters.pi!, PI],
    ['gemini-cli', builtinAdapters['gemini-cli']!, GEMINI],
    ['dsh', builtinAdapters.dsh!, DSH],
    ['opencode', builtinAdapters.opencode!, OPENCODE],
  ] as const) {
    const oversized = oversizedOf(agent)
    const fixtures: SessionAdapterFixtures = {
      platform,
      root: fixturesOf(agent),
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
