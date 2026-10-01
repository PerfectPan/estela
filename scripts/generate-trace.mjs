#!/usr/bin/env node
// Dev-only: writes a synthetic canonical agent-trace JSON file for local UI checks
// (plan 5.2 S8: a 10,000-event trace). All text is generated; nothing comes from a real session.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const HELP = `Usage:
  node scripts/generate-trace.mjs [--events <n>] [--out <dir>] [--name <file>] [--seed <n>]

Writes <dir>/<file> (default: $TMPDIR/agent-trace-generated/generated.trace.json), a
canonical agent-trace JSON trace shaped like a Claude Code session: turns with
requests whose input tokens grow, tool calls with results (a few failed, a few
with outputs longer than the 4,096-character view cap), thinking, replies, hook
runs, two subagent lanes, and an automatic compaction after about 55 % of the
requests (and again whenever the context passes 160k tokens). Prints the path. Open it with:

  node apps/cli/bin.mjs <path> --no-auth --no-open

Options:
  --events <n>  Stop after at least n events (default 10000; 260 gives a design-sized session).
  --out <dir>   Output directory (created if missing).
  --name <file> Output file name (default generated.trace.json).
  --seed <n>    Seed for the generator (default 7).
`

const { values } = parseArgs({
  options: {
    events: { type: 'string', default: '10000' },
    out: { type: 'string', default: join(tmpdir(), 'agent-trace-generated') },
    name: { type: 'string', default: 'generated.trace.json' },
    seed: { type: 'string', default: '7' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

const target = Number(values.events)
if (!Number.isInteger(target) || target < 50) {
  process.stderr.write('--events must be an integer of at least 50\n')
  process.exit(1)
}

// Mulberry32: deterministic output for a given seed.
let state = Number(values.seed) >>> 0
function random() {
  state = (state + 0x6D2B79F5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = list => list[Math.floor(random() * list.length)]
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1))

const PROMPTS = [
  'Why does the refresh test fail only in CI?',
  'Pin the clock in the test and rerun the suite',
  'Find every caller of refreshToken() and list them',
  'Check the CI config for timezone differences',
  'Make the retry backoff configurable',
  'Add a regression test for the expired token path',
  'Push it and open a PR',
  'Summarize what changed in this branch',
]
const FILES = ['src/auth/refresh.ts', 'src/auth/refresh.test.ts', 'src/auth/token-store.ts', 'src/http/client.ts', '.github/workflows/test.yml', 'vitest.config.ts']
const COMMANDS = ['pnpm vitest run src/auth', 'pnpm tsc --noEmit', 'git status --short', 'rg -n "refreshToken" src', 'gh run view 88121 --log-failed']
const THOUGHTS = [
  'The fake timer is installed after the module is imported, so the refresh interval still uses the real clock…',
  'The CI job sets TZ=UTC; the local run does not, so the expiry check crosses midnight differently…',
  'Two callers pass a stale token store; the third already awaits the refresh…',
]
const REPLIES = [
  'The flake came from a real timer in beforeEach. The test now installs fake timers before importing the module.',
  'All three callers now await the refresh before retrying.',
  'The suite passes locally and in CI with TZ=UTC.',
]
const SUBAGENTS = [
  { id: 'agent-callers', title: 'Explore · callers', prompt: 'Find every caller of refreshToken()' },
  { id: 'agent-ci', title: 'Explore · CI config', prompt: 'Read the CI workflow and report timezone settings' },
]

const FILE = 'generated.jsonl'
const events = []
let line = 0
let clock = Date.parse(process.env.GENERATED_TRACE_START ?? '') || (Date.now() - 3 * 3600_000)
const startedAt = clock
let requestSeq = 0
let callSeq = 0
let context = 8_000

function push(kind, payload, extra = {}) {
  line += 1
  const id = `g${line}`
  const event = {
    id,
    seq: events.length,
    ts: clock,
    kind,
    ...extra,
    payload,
    source: { file: FILE, offset: line * 100, length: 100, line },
    original: { type: kind, uuid: id, timestamp: new Date(clock).toISOString() },
  }
  events.push(event)
  return event
}

function tick(lo, hi) {
  clock += between(lo, hi)
}

function longOutput(seed) {
  const rows = []
  for (let index = 0; rows.join('\n').length < 6_000; index++)
    rows.push(`  ✓ src/auth/case-${seed}-${index}.test.ts > refresh > keeps the session (${between(2, 40)} ms)`)
  return rows.join('\n')
}

function request(agentId, grow = true) {
  requestSeq += 1
  const requestId = `req-${requestSeq}`
  if (grow)
    context += between(500, 1_100)
  const extra = agentId ? { agentId, requestId } : { requestId }
  const input = agentId ? between(6_000, 14_000) : context
  push('request', {
    model: 'claude-sonnet-5',
    usage: { inputTokens: input, outputTokens: between(120, 1_600) },
    durationMs: between(1_500, 9_000),
    stopReason: 'tool_use',
  }, extra)
  return requestId
}

function tool(agentId, requestId, { fail = false, long = false } = {}) {
  callSeq += 1
  const callId = `call-${callSeq}`
  const bash = random() < 0.4
  const name = bash ? 'Bash' : pick(['Read', 'Edit', 'Grep'])
  const args = bash ? { command: pick(COMMANDS) } : name === 'Grep' ? { pattern: 'refreshToken', path: 'src' } : { file_path: pick(FILES) }
  const extra = agentId ? { agentId, requestId } : { requestId }
  push('tool_call', { callId, name, args }, extra)
  tick(300, bash ? 12_000 : 1_500)
  const output = long ? longOutput(callSeq) : bash ? (fail ? 'FAIL src/auth/refresh.test.ts > refresh > renews before expiry\nAssertionError: expected 2 to be 1' : 'ok') : `// ${args.file_path ?? 'src'}\nexport function refreshToken() {}`
  push('tool_result', { callId, output, ...(fail ? { isError: true, exitCode: 1 } : bash ? { exitCode: 0 } : {}) }, agentId ? { agentId } : {})
}

function hooks() {
  const count = between(2, 6)
  for (let index = 0; index < count; index++) {
    push('hook', { name: index % 2 === 0 ? 'PreToolUse' : 'PostToolUse', event: 'hook_success' })
    tick(20, 200)
  }
}

function subagent(spec) {
  callSeq += 1
  const callId = `call-${callSeq}`
  const spawn = push('tool_call', { callId, name: 'Task', args: { description: spec.prompt, subagent_type: 'Explore' } }, { requestId: `req-${requestSeq}` })
  agents.push({ id: spec.id, parentId: 'main', spawnEventId: spawn.id, title: spec.title })
  const rounds = between(6, 10)
  for (let index = 0; index < rounds; index++) {
    tick(4_000, 30_000)
    const requestId = request(spec.id, false)
    tool(spec.id, requestId, { fail: index === rounds - 2 && spec.id === SUBAGENTS[1].id })
  }
  tick(2_000, 6_000)
  push('assistant', { text: `Done: ${spec.prompt.toLowerCase()}.` }, { agentId: spec.id })
  push('tool_result', { callId, output: `The ${spec.title} agent finished.` })
}

const agents = [{ id: 'main' }]
const totalTurns = Math.max(7, Math.round(target / 38))
const compactAtRequest = Math.round((target / 4) * 0.55)
let compacted = false
let failures = 0
let turn = 0

while (events.length < target) {
  turn += 1
  tick(20_000, 90_000)
  push('user', { text: PROMPTS[(turn - 1) % PROMPTS.length] })
  const turnStart = clock
  const rounds = between(12, 26)
  for (let index = 0; index < rounds && events.length < target; index++) {
    tick(3_000, 12_000)
    const requestId = request(undefined)
    if (random() < 0.3)
      push('thinking', { text: pick(THOUGHTS) }, { requestId })
    const fail = failures < Math.max(3, Math.round(target / 900)) && random() < 0.05
    if (fail)
      failures += 1
    tool(undefined, requestId, { fail, long: requestSeq % 40 === 7 })
    if (random() < 0.15)
      hooks()
    if (turn === 3 && index === 4 && !agents.some(agent => agent.id === SUBAGENTS[0].id))
      subagent(SUBAGENTS[0])
    if (turn === 5 && index === 3 && !agents.some(agent => agent.id === SUBAGENTS[1].id))
      subagent(SUBAGENTS[1])
    // The first compaction at about 55 % of the requests, later ones when the context passes 160k.
    if ((!compacted && requestSeq >= compactAtRequest) || context > 160_000) {
      compacted = true
      tick(2_000, 4_000)
      const pre = context
      context = 22_100
      const boundary = push('compaction', { trigger: 'auto', preTokens: pre, postTokens: context })
      push('user', { text: 'Summary of the earlier conversation: the refresh test flakes because of a real timer.', compactSummary: true })
      boundary.payload.summaryEventId = events.at(-1).id
      for (const event of events) {
        if (event.seq < boundary.seq && event.agentId === undefined && event.kind !== 'compaction' && !event.shadowedBy)
          event.shadowedBy = boundary.id
      }
    }
  }
  tick(2_000, 8_000)
  push('assistant', { text: pick(REPLIES) })
  push('system', { type: 'turn_duration', durationMs: clock - turnStart })
  if (turn >= totalTurns && events.length >= target)
    break
}

const trace = {
  schema: 'agent-trace',
  host: { id: 'claude-code' },
  session: {
    id: `generated-${values.seed}`,
    title: 'Fix flaky auth refresh test',
    cwd: '/work/checkout-service',
    startedAt,
    endedAt: clock,
  },
  capabilities: ['requests', 'usage', 'durations', 'thinking', 'compaction', 'compactionTokens', 'subagents', 'hooks'],
  agents,
  events,
  skipped: [],
}

const dir = resolve(values.out)
mkdirSync(dir, { recursive: true })
const path = join(dir, values.name)
writeFileSync(path, `${JSON.stringify(trace)}\n`)
process.stdout.write(`${path}\n${events.length} events, ${requestSeq} requests, ${turn} turns\n`)
