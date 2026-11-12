// A synthetic HOME with many Claude Code and Codex sessions for the first-rows budget.
// Generated text only, deterministic for a given count: nothing here reads or copies a real session.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WORDS = [
  'build',
  'cache',
  'delta',
  'error',
  'field',
  'graph',
  'index',
  'kernel',
  'model',
  'parse',
  'query',
  'token',
]
/** Every session ends within the 30 days before this instant, newest first by index. */
const NEWEST = Date.UTC(2026, 9, 1)
const SPREAD_MS = 30 * 24 * 3600 * 1000

function words(count, salt) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push(WORDS[(salt * 31 + i * 7) % WORDS.length])
  }
  return out.join(' ')
}

/** A UUID-shaped id that is the same for the same agent and index. */
function sessionId(prefix, index) {
  const hex = (index * 2654435761 + prefix.charCodeAt(0)).toString(16).padStart(12, '0').slice(-12)
  return `${prefix}000000-0000-4000-8000-${hex}`
}

function iso(ms) {
  return new Date(ms).toISOString()
}

/** 1 to 12 turns, and tool outputs from 200 characters to about 8 KB, so file sizes vary as in a real home. */
function shape(index) {
  return { turns: 1 + (index % 12), output: 200 + (index % 9) * 900 }
}

function claudeSession(index, start) {
  const id = sessionId('c', index)
  const cwd = `/work/project-${index % 40}`
  const { turns, output } = shape(index)
  const lines = []
  let clock = start
  const base = { sessionId: id, cwd, version: '2.0.0' }
  for (let turn = 1; turn <= turns; turn++) {
    const tool = `toolu-${turn}`
    lines.push({
      type: 'user',
      uuid: `u${turn}a`,
      timestamp: iso((clock += 1000)),
      ...base,
      message: { role: 'user', content: `Task ${index}.${turn}: ${words(12, index + turn)}` },
    })
    lines.push({
      type: 'assistant',
      uuid: `a${turn}a`,
      timestamp: iso((clock += 1000)),
      ...base,
      requestId: `req-${turn}a`,
      message: {
        role: 'assistant',
        model: 'claude-test',
        id: `msg-${turn}a`,
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 1000 * turn,
          output_tokens: 40,
          cache_read_input_tokens: 800 * turn,
          cache_creation_input_tokens: 20,
        },
        content: [
          { type: 'thinking', thinking: words(20, turn) },
          { type: 'tool_use', id: tool, name: 'Bash', input: { command: `npm test -- ${turn}` } },
        ],
      },
    })
    lines.push({
      type: 'user',
      uuid: `u${turn}b`,
      timestamp: iso((clock += 1000)),
      ...base,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tool, content: words(output / 6, turn) }],
      },
    })
    lines.push({
      type: 'assistant',
      uuid: `a${turn}b`,
      timestamp: iso((clock += 1000)),
      ...base,
      requestId: `req-${turn}b`,
      message: {
        role: 'assistant',
        model: 'claude-test',
        id: `msg-${turn}b`,
        stop_reason: 'end_turn',
        usage: { input_tokens: 1100 * turn, output_tokens: 60 },
        content: [{ type: 'text', text: words(30, turn) }],
      },
    })
  }
  return { id, cwd, end: clock, text: lines.map(line => `${JSON.stringify(line)}\n`).join('') }
}

function codexUsage(input) {
  return {
    input_tokens: input,
    cached_input_tokens: Math.floor(input * 0.8),
    output_tokens: 50,
    cache_write_input_tokens: 0,
    reasoning_output_tokens: 5,
    total_tokens: input + 50,
  }
}

function codexSession(index, start) {
  const id = sessionId('d', index)
  const { turns, output } = shape(index)
  const lines = []
  let clock = start
  const put = (type, payload) => lines.push({ timestamp: iso((clock += 500)), type, payload })
  put('session_meta', {
    id,
    session_id: id,
    timestamp: iso(start),
    cwd: `/work/service-${index % 40}`,
    originator: 'codex_cli',
    cli_version: '0.1.0',
    source: 'cli',
    model_provider: 'openai',
    base_instructions: { text: 'Be brief.' },
  })
  for (let turn = 1; turn <= turns; turn++) {
    const turnId = `turn-${turn}`
    put('turn_context', {
      turn_id: turnId,
      cwd: `/work/service-${index % 40}`,
      approval_policy: 'never',
      sandbox_policy: { type: 'read-only' },
      model: 'gpt-test',
      effort: 'medium',
      summary: 'auto',
    })
    put('event_msg', { type: 'task_started', turn_id: turnId, started_at: turn, model_context_window: 200000 })
    put('response_item', {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: `Task ${index}.${turn}: ${words(12, index + turn)}` }],
    })
    put('response_item', {
      type: 'function_call',
      name: 'shell',
      arguments: JSON.stringify({ command: ['npm', 'test'] }),
      call_id: `call-${turn}`,
    })
    put('event_msg', {
      type: 'token_count',
      info: {
        total_token_usage: codexUsage(1000 * turn),
        last_token_usage: codexUsage(1000),
        model_context_window: 200000,
      },
      rate_limits: null,
    })
    put('response_item', {
      type: 'function_call_output',
      call_id: `call-${turn}`,
      output: `Exit code: 0\nOutput:\n${words(output / 6, turn)}`,
    })
    put('response_item', {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: words(30, turn) }],
      phase: 'final',
    })
    put('event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: 'done', duration_ms: 3000 })
  }
  return { id, end: clock, text: lines.map(line => `${JSON.stringify(line)}\n`).join('') }
}

/**
 * Writes `perAgent` Claude Code sessions under `<home>/.claude/projects/` and as many Codex rollouts
 * under `<home>/.codex/sessions/`, with mtimes spread over 30 days. Returns the counts and total bytes.
 */
export function writeSyntheticHome(home, perAgent) {
  let bytes = 0
  for (let index = 0; index < perAgent; index++) {
    const start = NEWEST - Math.floor((index / perAgent) * SPREAD_MS)
    const claude = claudeSession(index, start)
    const project = join(home, '.claude/projects', `-work-project-${index % 40}`)
    mkdirSync(project, { recursive: true })
    const claudePath = join(project, `${claude.id}.jsonl`)
    writeFileSync(claudePath, claude.text)
    utimesSync(claudePath, claude.end / 1000, claude.end / 1000)
    bytes += Buffer.byteLength(claude.text)

    const codex = codexSession(index, start)
    const day = new Date(start)
    const dir = join(
      home,
      '.codex/sessions',
      String(day.getUTCFullYear()),
      String(day.getUTCMonth() + 1).padStart(2, '0'),
      String(day.getUTCDate()).padStart(2, '0'),
    )
    mkdirSync(dir, { recursive: true })
    const stamp = iso(start).slice(0, 19).replaceAll(':', '-')
    const codexPath = join(dir, `rollout-${stamp}-${codex.id}.jsonl`)
    writeFileSync(codexPath, codex.text)
    utimesSync(codexPath, codex.end / 1000, codex.end / 1000)
    bytes += Buffer.byteLength(codex.text)
  }
  return { sessions: { 'claude-code': perAgent, codex: perAgent }, bytes }
}
