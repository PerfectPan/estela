import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/**
 * Test helper for S12 (plan 5.2, 1.3): writes a synthetic Codex rollout of at
 * least `targetBytes`, shaped like the largest local session (A.6) but with
 * generated text only. Per turn: a prompt, nine tool calls with usage records,
 * outputs from 900 characters to 45 KB (one 2 MB output every 40 turns),
 * `item_completed` rows, and a reply. Every fifth turn adds a `compacted`
 * record whose `replacement_history` grows from 1 MB to 9 MB; those records
 * are most of the bytes, as in the real file. The caller picks a temp directory
 * and deletes it; nothing here is committed output.
 */
export interface LargeSession {
  path: string
  bytes: number
  turns: number
  /** Tool outputs longer than 4,096 characters. */
  longOutputs: number
  /** Call id and exact length of the longest output, for `get-event` checks. */
  longest: { callId: string, length: number }
}

const WORDS = ['alpha', 'build', 'cache', 'delta', 'error', 'field', 'graph', 'index', 'json', 'kernel', 'lane', 'model', 'node', 'offset', 'parse', 'query', 'range', 'slot', 'token', 'usage', 'value', 'width', 'yield', 'zero']
const STEPS = 9
const OUTPUT_SIZES = [900, 900, 18_000, 900, 900, 45_000, 900, 18_000, 900]

function corpus(size: number): string {
  let seed = 7
  const parts: string[] = []
  let length = 0
  while (length < size) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const word = `${WORDS[seed % WORDS.length]}${seed % 97 === 0 ? '\n' : ' '}`
    parts.push(word)
    length += word.length
  }
  return parts.join('')
}

const TEXT = corpus(256 * 1024)

function text(length: number, salt: number): string {
  let out = ''
  let offset = (salt * 7919) % TEXT.length
  while (out.length < length) {
    const piece = TEXT.slice(offset, offset + length - out.length)
    out += piece
    offset = 0
  }
  return out
}

function stamp(ms: number): string {
  return new Date(Date.UTC(2026, 0, 1) + ms).toISOString()
}

function usage(input: number, output: number): Record<string, number> {
  return { input_tokens: input, cached_input_tokens: Math.floor(input * 0.8), output_tokens: output, cache_write_input_tokens: 0, reasoning_output_tokens: 10, total_tokens: input + output }
}

export function writeLargeCodexSession(directory: string, opts: { targetBytes: number }): LargeSession {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'rollout-2026-01-01T00-00-00-synthetic-large.jsonl')
  const fd = openSync(path, 'w')
  let bytes = 0
  let clock = 0
  let pending: string[] = []
  let pendingBytes = 0
  const flush = (): void => {
    if (pending.length === 0)
      return
    bytes += writeSync(fd, pending.join(''))
    pending = []
    pendingBytes = 0
  }
  const put = (type: string, payload: Record<string, unknown>): void => {
    clock += 250
    const line = `${JSON.stringify({ timestamp: stamp(clock), type, payload })}\n`
    pending.push(line)
    pendingBytes += line.length
    if (pendingBytes > 8 * 1024 * 1024)
      flush()
  }
  const result: LargeSession = { path, bytes: 0, turns: 0, longOutputs: 0, longest: { callId: '', length: 0 } }
  const history: Record<string, unknown>[] = []
  let context = 20_000

  put('session_meta', { id: 'synthetic-large', session_id: 'synthetic-large', timestamp: stamp(0), cwd: '/work/app', originator: 'codex_cli', cli_version: '0.1.0', source: 'cli', model_provider: 'openai', base_instructions: { text: text(4000, 1) } })
  try {
    for (let turn = 1; bytes + pendingBytes < opts.targetBytes; turn++) {
      const turnId = `turn-${turn}`
      put('turn_context', { turn_id: turnId, cwd: '/work/app', approval_policy: 'never', sandbox_policy: { type: 'read-only' }, model: 'gpt-synthetic', effort: 'medium', summary: 'auto', user_instructions: text(2000, turn) })
      put('event_msg', { type: 'task_started', turn_id: turnId, started_at: turn, model_context_window: 400_000 })
      const prompt = { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Task ${turn}: ${text(150, turn)}` }] }
      put('response_item', prompt)
      history.push(prompt)
      for (let step = 0; step < STEPS; step++) {
        const callId = `call-${turn}-${step}`
        context += 900
        put('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: text(200, turn + step) }], content: null, encrypted_content: text(1600, step) })
        put('response_item', { type: 'custom_tool_call', status: 'completed', call_id: callId, name: 'apply_patch', input: text(1200, turn * step) })
        put('token_usage_record', { session_id: 'synthetic-large', thread_id: 'synthetic-large', turn_id: turnId, root_turn_id: turnId, response_id: `resp-${turn}-${step}`, usage: usage(context, 300), turn_token_usage: usage(context, 300), thread_token_usage: usage(context * turn, 300 * turn) })
        put('event_msg', { type: 'token_count', info: { total_token_usage: usage(context * turn, 300 * turn), last_token_usage: usage(context, 300), model_context_window: 400_000 }, rate_limits: null })
        const size = turn % 40 === 0 && step === 5 ? 2_000_000 : OUTPUT_SIZES[step]!
        const output = `Exit code: 0\nWall time: 0.4 seconds\nOutput:\n${text(size, turn + step)}`
        if (output.length > 4096)
          result.longOutputs += 1
        if (output.length > result.longest.length)
          result.longest = { callId, length: output.length }
        put('response_item', { type: 'custom_tool_call_output', call_id: callId, output })
        put('event_msg', { type: 'item_completed', thread_id: 'synthetic-large', turn_id: turnId, started_at_ms: clock, completed_at_ms: clock + 100, item: { type: 'CommandExecution', id: `item-${turn}-${step}`, aggregated_output: text(5000, step) } })
      }
      const reply = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: text(1000, turn) }], phase: 'final' }
      put('response_item', reply)
      history.push(reply)
      put('event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: 'done', duration_ms: 30_000 })
      if (turn % 5 === 0) {
        const size = Math.min(1_000_000 + turn * 30_000, 9_000_000)
        const chunks = Math.ceil(size / 50_000)
        const replacement = [
          ...history.slice(-4),
          ...Array.from({ length: chunks }, (_, index) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text: text(50_000, turn + index) }] })),
          { type: 'compaction', encrypted_content: text(2000, turn) },
        ]
        put('compacted', { message: text(3000, turn), replacement_history: replacement })
        context = 30_000
      }
      result.turns = turn
      flush()
    }
    flush()
  }
  finally {
    closeSync(fd)
  }
  result.bytes = bytes
  return result
}

// Run by path (`node large-session.ts <directory> <bytes>`, as the browser suite does): writes the
// file and prints the `LargeSession` as JSON.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, bytes] = process.argv.slice(2)
  if (!directory || !Number(bytes)) {
    process.stderr.write('usage: node large-session.ts <directory> <target bytes>\n')
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(writeLargeCodexSession(directory, { targetBytes: Number(bytes) }))}\n`)
}
