import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Small invented sessions in the on-disk formats of Claude Code, Codex, Gemini CLI, and Grok, for
 * the demo home's session browser. Each format follows the conformance fixtures under
 * `fixtures/sessions/<agent>/conformance/`; the content is a scripted conversation.
 */
export interface Step {
  /** A shell command the agent ran. */
  command: string
  output: string
  exitCode?: number
}

export interface Turn {
  prompt: string
  steps: Step[]
  reply: string
}

export interface ChatSpec {
  /** Session id; also names the files. */
  id: string
  cwd: string
  /** Start time, ms since the epoch (UTC). */
  start: number
  model: string
  title?: string
  turns: Turn[]
}

/** Per-turn token growth: each step's output and the reply add to a context that starts at `base`. */
function tokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

async function put(path: string, text: string, mtime: number): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  // The browser sorts by the session's own times; the mtime matches them so the index agrees.
  await utimes(path, mtime / 1000, mtime / 1000)
  return path
}

/** Walks `spec` with a clock: `on(kind, at, ...)` per prompt, step, and reply. */
function walk(
  spec: ChatSpec,
  on: {
    prompt: (turn: Turn, at: number, index: number) => void
    step: (step: Step, at: number, done: number, index: number) => void
    reply: (turn: Turn, at: number, input: number, output: number, index: number) => void
  },
): number {
  let clock = spec.start
  let context = 9_000
  let calls = 0
  spec.turns.forEach((turn, index) => {
    if (index > 0) {
      clock += 95_000 + index * 13_000
    }
    on.prompt(turn, clock, index)
    context += tokens(turn.prompt)
    for (const step of turn.steps) {
      clock += 4_000 + (step.command.length % 7) * 900
      const done = clock + 600 + (step.output.length % 11) * 300
      on.step(step, clock, done, calls++)
      clock = done
      context += tokens(step.output) + 120
    }
    clock += 5_000
    const output = tokens(turn.reply) + 40
    on.reply(turn, clock, context, output, index)
    context += output
  })
  return clock
}

const iso = (ms: number) => new Date(ms).toISOString()

/** Claude Code: `~/.claude/projects/<cwd with - for every other character>/<id>.jsonl`. */
export async function claudeSession(home: string, spec: ChatSpec): Promise<string> {
  const lines: string[] = []
  let seq = 0
  const base = { sessionId: spec.id, cwd: spec.cwd, version: '2.1.297', gitBranch: 'main', userType: 'external' }
  const push = (at: number, record: Record<string, unknown>) =>
    lines.push(JSON.stringify({ ...base, ...record, uuid: `${spec.id.slice(0, 8)}-${++seq}`, timestamp: iso(at) }))
  if (spec.title) {
    lines.push(JSON.stringify({ type: 'ai-title', aiTitle: spec.title, sessionId: spec.id }))
  }
  const message = (n: number, at: number, input: number, output: number, content: unknown[], stop: string) =>
    push(at, {
      type: 'assistant',
      requestId: `req_${spec.id.slice(0, 6)}${n}`,
      message: {
        id: `msg_${spec.id.slice(0, 6)}${n}`,
        role: 'assistant',
        model: spec.model,
        stop_reason: stop,
        content,
        usage: {
          input_tokens: 6,
          cache_read_input_tokens: input - 900,
          cache_creation_input_tokens: 894,
          output_tokens: output,
        },
      },
    })
  let n = 0
  let context = 9_000
  const end = walk(spec, {
    prompt: (turn, at) => push(at, { type: 'user', message: { role: 'user', content: turn.prompt } }),
    step: (step, at, done, index) => {
      const id = `toolu_${spec.id.slice(0, 6)}${index}`
      message(
        ++n,
        at,
        (context += 300),
        90,
        [{ type: 'tool_use', id, name: 'Bash', input: { command: step.command } }],
        'tool_use',
      )
      const failed = (step.exitCode ?? 0) !== 0
      push(done, {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: id,
              content: failed ? `Exit code ${step.exitCode}\n${step.output}` : step.output,
              ...(failed ? { is_error: true } : {}),
            },
          ],
        },
      })
      context += tokens(step.output)
    },
    reply: (turn, at, input, output) =>
      message(++n, at, Math.max(input, context), output, [{ type: 'text', text: turn.reply }], 'end_turn'),
  })
  const folder = spec.cwd.replaceAll(/[^A-Za-z0-9]/g, '-')
  return put(join(home, '.claude/projects', folder, `${spec.id}.jsonl`), `${lines.join('\n')}\n`, end)
}

/** Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`. */
export async function codexSession(home: string, spec: ChatSpec): Promise<string> {
  const lines: string[] = []
  const push = (at: number, type: string, payload: unknown) =>
    lines.push(JSON.stringify({ timestamp: iso(at), type, payload }))
  push(spec.start, 'session_meta', {
    id: spec.id,
    timestamp: iso(spec.start),
    cwd: spec.cwd,
    originator: 'codex_cli_rs',
    cli_version: '0.58.0',
    source: 'cli',
    model_provider: 'openai',
  })
  const usage = (input: number, output: number) => ({
    input_tokens: input,
    cached_input_tokens: Math.max(0, input - 1_400),
    output_tokens: output,
    reasoning_output_tokens: Math.round(output / 3),
    total_tokens: input + output,
  })
  let total = { input: 0, output: 0 }
  const count = (at: number, input: number, output: number) => {
    total = { input: total.input + input, output: total.output + output }
    push(at, 'event_msg', {
      type: 'token_count',
      info: {
        total_token_usage: usage(total.input, total.output),
        last_token_usage: usage(input, output),
        model_context_window: 272_000,
      },
      rate_limits: null,
    })
  }
  let context = 9_000
  const end = walk(spec, {
    prompt: (turn, at, index) => {
      push(at, 'turn_context', {
        turn_id: `turn-${index + 1}`,
        cwd: spec.cwd,
        approval_policy: 'on-request',
        sandbox_policy: { type: 'workspace-write' },
        model: spec.model,
        effort: 'medium',
        summary: 'auto',
      })
      push(at, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.prompt }] })
    },
    step: (step, at, done, index) => {
      const callId = `call_${spec.id.slice(0, 6)}${index}`
      push(at, 'response_item', {
        type: 'function_call',
        name: 'shell',
        arguments: JSON.stringify({ command: ['bash', '-lc', step.command], workdir: spec.cwd }),
        call_id: callId,
      })
      count(at + 100, (context += 250), 80)
      push(done, 'response_item', {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({
          output: step.output,
          metadata: { exit_code: step.exitCode ?? 0, duration_seconds: (done - at) / 1000 },
        }),
      })
      context += tokens(step.output)
    },
    reply: (turn, at, input, output) => {
      push(at, 'response_item', {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: turn.reply }],
      })
      count(at + 100, Math.max(input, context), output)
    },
  })
  const day = new Date(spec.start)
  const dir = join(
    home,
    '.codex/sessions',
    String(day.getUTCFullYear()),
    String(day.getUTCMonth() + 1).padStart(2, '0'),
    String(day.getUTCDate()).padStart(2, '0'),
  )
  const stamp = iso(spec.start).slice(0, 19).replaceAll(':', '-')
  return put(join(dir, `rollout-${stamp}-${spec.id}.jsonl`), `${lines.join('\n')}\n`, end)
}

/** Gemini CLI: `~/.gemini/tmp/<project>/chats/session-<time>-<id>.jsonl`. */
export async function geminiSession(home: string, spec: ChatSpec, project: string): Promise<string> {
  const lines: string[] = []
  const push = (record: Record<string, unknown>) => lines.push(JSON.stringify(record))
  const body: string[] = []
  let n = 0
  const end = walk(spec, {
    prompt: (turn, at) =>
      body.push(JSON.stringify({ id: `u${++n}`, type: 'user', content: turn.prompt, timestamp: iso(at) })),
    step: (step, at, done, index) => {
      const id = `g${++n}`
      const call = { id: `t${index}`, name: 'run_shell_command', args: { command: step.command } }
      body.push(
        JSON.stringify({ id, type: 'gemini', content: '', model: spec.model, toolCalls: [call], timestamp: iso(at) }),
      )
      body.push(
        JSON.stringify({
          id,
          type: 'gemini',
          content: '',
          model: spec.model,
          toolCalls: [
            { ...call, status: (step.exitCode ?? 0) === 0 ? 'success' : 'error', resultDisplay: step.output },
          ],
          timestamp: iso(done),
        }),
      )
    },
    reply: (turn, at, input, output) =>
      body.push(
        JSON.stringify({
          id: `g${++n}`,
          type: 'gemini',
          content: turn.reply,
          model: spec.model,
          tokens: {
            input,
            output,
            cached: Math.max(0, input - 2_000),
            thoughts: Math.round(output / 2),
            tool: 0,
            total: input + output,
          },
          timestamp: iso(at),
        }),
      ),
  })
  push({ sessionId: spec.id, projectHash: project, startTime: iso(spec.start), lastUpdated: iso(end), kind: 'main' })
  const stamp = iso(spec.start).slice(0, 16).replaceAll(':', '-')
  return put(
    join(home, '.gemini/tmp', project, 'chats', `session-${stamp}-${spec.id.slice(0, 8)}.jsonl`),
    `${[...lines, ...body].join('\n')}\n`,
    end,
  )
}

/** Grok: `~/.grok/sessions/<cwd folder>/<id>/summary.json` and `updates.jsonl`. */
export async function grokSession(home: string, spec: ChatSpec): Promise<string> {
  const lines: string[] = []
  const update = (at: number, value: Record<string, unknown>) =>
    lines.push(
      JSON.stringify({ method: 'session/update', params: { sessionId: spec.id, update: value }, timestamp: at / 1000 }),
    )
  const end = walk(spec, {
    prompt: (turn, at, index) =>
      update(at, {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: turn.prompt },
        _meta: { modelId: spec.model, promptIndex: index },
      }),
    step: (step, at, done, index) => {
      const id = `call-${index + 1}`
      update(at, {
        sessionUpdate: 'tool_call',
        toolCallId: id,
        title: 'shell',
        rawInput: { command: step.command },
        _meta: {},
      })
      update(done, {
        sessionUpdate: 'tool_call_update',
        toolCallId: id,
        status: (step.exitCode ?? 0) === 0 ? 'completed' : 'failed',
        content: [{ type: 'content', content: { type: 'text', text: step.output } }],
        rawOutput: { exit_code: step.exitCode ?? 0 },
      })
    },
    reply: (turn, at, input, output, index) => {
      update(at, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: turn.reply } })
      update(at + 200, {
        sessionUpdate: 'turn_completed',
        prompt_id: `prompt-${index + 1}`,
        stop_reason: 'end_turn',
        elapsed_ms: 20_000,
        usage: {
          inputTokens: input,
          outputTokens: output,
          cachedReadTokens: Math.max(0, input - 1_500),
          totalTokens: input + output,
          modelCalls: turn.steps.length + 1,
        },
      })
    },
  })
  const dir = join(home, '.grok/sessions', spec.cwd.replaceAll('/', '-').replace(/^-/, ''), spec.id)
  const summary = {
    info: { id: spec.id, cwd: spec.cwd },
    generated_title: spec.title ?? spec.turns[0]!.prompt,
    chat_format_version: 1,
    created_at: iso(spec.start),
    last_active_at: iso(end),
  }
  await put(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, end)
  return put(join(dir, 'updates.jsonl'), `${lines.join('\n')}\n`, end)
}
