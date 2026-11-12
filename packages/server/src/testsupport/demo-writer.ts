/**
 * Writes a Claude Code session log (`<session>.jsonl` plus `<session>/subagents/agent-*.jsonl`
 * and `.meta.json`) in the record shapes Claude Code 2.1 writes, for the demo session. Ids are
 * derived from counters, so the same script always writes the same bytes.
 *
 * Token accounting follows the API: a request's input is the whole context; the prefix the
 * previous request sent is a cache read, the rest a 5-minute cache write, and a few uncached
 * tokens stay in `input_tokens`. Each request's output and each tool result grow the context.
 */

const VERSION = '2.1.301'
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** A deterministic string of `length` characters from `alphabet` for `seed`. */
function token(seed: number, length: number, alphabet = BASE62): string {
  let state = Math.imul(seed + 1, 2654435761) >>> 0
  let out = ''
  for (let index = 0; index < length; index++) {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    out += alphabet[((mixed ^ (mixed >>> 14)) >>> 0) % alphabet.length]
  }
  return out
}

/** A deterministic UUID-shaped id for `seed`. */
function uuid(seed: number): string {
  const hex = token(seed * 7 + 5, 32, '0123456789abcdef')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}

/** About 3.6 characters per token, the rough rate for code and English. */
function tokensOf(text: string): number {
  return Math.ceil(text.length / 3.6)
}

/** Tokens of the system prompt and tool definitions, the prefix every main request starts with. */
const SYSTEM_AND_TOOLS = 14_820

const CLI_PREFIX = 'You are Claude Code, a command line coding agent.'

const HOOK_COMMANDS: Record<string, string> = {
  SessionStart: 'node .claude/hooks/print-branch.mjs',
  PostToolUse: 'pnpm exec prettier --write "$CLAUDE_FILE_PATHS"',
  Stop: 'node .claude/hooks/notify.mjs',
}

interface RequestSpec {
  thinking?: string
  text?: string
  tool?: { name: string; input: Record<string, unknown> }
  /** Output tokens (thinking included). */
  output: number
  /** Seconds the response took to stream. */
  seconds: number
  stop?: 'tool_use' | 'end_turn'
}

interface ResultSpec {
  output: string
  isError?: boolean
  /** Tokens the result adds to the context; defaults to its length / 3.6. */
  tokens?: number
  /** Seconds the tool ran. */
  seconds: number
  /** Claude Code's structured `toolUseResult` beside the content block. */
  detail?: Record<string, unknown>
}

interface Shared {
  sessionId: string
  cwd: string
  seq: number
  clock: number
  gitBranch: string
}

/** One lane's file: the main session or a subagent. */
class LaneWriter {
  readonly lines: string[] = []
  private parent: string | null = null
  /** Tokens the next request sends. */
  context: number
  /** The prefix the previous request sent, which the cache holds. */
  private cached: number
  requests = 0
  private readonly shared: Shared
  private readonly model: string
  private readonly agentId: string | undefined

  constructor(shared: Shared, model: string, agentId: string | undefined, context: number, cached: number) {
    this.shared = shared
    this.model = model
    this.agentId = agentId
    this.context = context
    this.cached = cached
  }

  private next(): number {
    this.shared.seq += 1
    return this.shared.seq
  }

  tick(seconds: number): void {
    this.shared.clock += Math.round(seconds * 1000)
  }

  private record(fields: Record<string, unknown>): string {
    const id = uuid(this.next())
    const base = {
      parentUuid: this.parent,
      isSidechain: this.agentId !== undefined,
      userType: 'external',
      cwd: this.shared.cwd,
      sessionId: this.shared.sessionId,
      version: VERSION,
      gitBranch: this.shared.gitBranch,
      ...(this.agentId ? { agentId: this.agentId } : {}),
    }
    this.lines.push(
      JSON.stringify({ ...base, ...fields, uuid: id, timestamp: new Date(this.shared.clock).toISOString() }),
    )
    this.parent = id
    return id
  }

  /** A prompt snapshot attachment: the system prompt, and on later snapshots the tool list. */
  snapshot(systemPrompt: string[], tools?: unknown[]): void {
    this.record({
      type: 'attachment',
      attachment: { type: 'prompt_snapshot', systemPrompt, ...(tools ? { tools, cliPrefix: CLI_PREFIX } : {}) },
    })
  }

  user(text: string): void {
    this.record({ type: 'user', message: { role: 'user', content: text } })
    this.context += tokensOf(text) + 4
  }

  /** One model request: a record per content block, each with the request's usage. Returns the tool use id. */
  request(spec: RequestSpec): string | undefined {
    this.requests += 1
    const n = this.next()
    const requestId = `req_011C${token(n, 18)}`
    const messageId = `msg_01${token(n + 1, 22)}`
    const fresh = 3 + (n % 9)
    const write = Math.max(0, this.context - this.cached - fresh)
    const usage = {
      input_tokens: fresh,
      cache_creation_input_tokens: write,
      cache_read_input_tokens: this.cached,
      cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 },
      output_tokens: spec.output,
      service_tier: 'standard',
    }
    const toolId = spec.tool ? `toolu_01${token(n + 2, 22)}` : undefined
    const blocks: Record<string, unknown>[] = []
    if (spec.thinking) {
      blocks.push({ type: 'thinking', thinking: spec.thinking, signature: token(n + 3, 64) })
    }
    if (spec.text) {
      blocks.push({ type: 'text', text: spec.text })
    }
    if (spec.tool) {
      blocks.push({ type: 'tool_use', id: toolId, name: spec.tool.name, input: spec.tool.input })
    }
    const stop = spec.stop ?? (spec.tool ? 'tool_use' : 'end_turn')
    // Each block is written when it has streamed, the last one at the end of the request.
    for (const block of blocks) {
      this.tick(spec.seconds / Math.max(1, blocks.length))
      this.record({
        type: 'assistant',
        requestId,
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [block],
          stop_reason: stop,
          stop_sequence: null,
          usage,
        },
      })
    }
    this.cached = this.context
    this.context += spec.output
    return toolId
  }

  result(toolId: string | undefined, spec: ResultSpec): void {
    this.tick(spec.seconds)
    this.record({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: toolId,
            type: 'tool_result',
            content: spec.output,
            ...(spec.isError ? { is_error: true } : {}),
          },
        ],
      },
      toolUseResult: spec.detail ?? (spec.isError ? `Error: ${spec.output.split('\n')[0]}` : { stdout: spec.output }),
    })
    this.context += spec.tokens ?? tokensOf(spec.output)
  }

  hook(event: string, matcher: string, toolId?: string, stdout = ''): void {
    this.tick(0.4)
    this.record({
      type: 'attachment',
      attachment: {
        type: 'hook_success',
        hookName: `${event}:${matcher}`,
        hookEvent: event,
        ...(toolId ? { toolUseID: toolId } : {}),
        content: '',
        stdout,
        stderr: '',
        exitCode: 0,
        command: HOOK_COMMANDS[event] ?? 'true',
        durationMs: 180 + (stdout.length % 300),
      },
    })
  }

  turnDuration(ms: number): void {
    this.record({ type: 'system', subtype: 'turn_duration', durationMs: ms, isMeta: false, level: 'info' })
  }

  /**
   * A `/compact` the user ran: the command record, the boundary, the summary Claude Code writes as
   * a user message, and the command's output. The context drops to the system prompt, tools, and summary.
   */
  compact(summary: string, durationMs: number): { pre: number; post: number } {
    const pre = this.context
    const post = SYSTEM_AND_TOOLS + tokensOf(summary)
    this.record({
      type: 'user',
      message: {
        role: 'user',
        content:
          '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>',
      },
    })
    this.tick(durationMs / 1000)
    this.record({
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      level: 'info',
      isMeta: false,
      compactMetadata: { trigger: 'manual', preTokens: pre, postTokens: post, durationMs },
    })
    this.record({
      type: 'user',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: { role: 'user', content: summary },
    })
    this.record({
      type: 'user',
      message: {
        role: 'user',
        content: '<local-command-stdout>Compacted. ctrl+o to see full summary</local-command-stdout>',
      },
    })
    this.context = post
    this.cached = SYSTEM_AND_TOOLS
    return { pre, post }
  }

  title(text: string): void {
    this.lines.push(JSON.stringify({ type: 'ai-title', aiTitle: text, sessionId: this.shared.sessionId }))
  }
}

interface SessionFiles {
  /** The main session file name and lines. */
  main: { name: string; lines: string[] }
  /** Subagent files relative to the session's companion directory. */
  extra: { name: string; text: string }[]
}

/** The session, its lanes, and the shared clock and id counter. */
export class SessionWriter {
  private readonly shared: Shared
  readonly main: LaneWriter
  private readonly subagents: { id: string; lane: LaneWriter; meta: Record<string, unknown> }[] = []

  constructor(options: { sessionId: string; cwd: string; start: number; model: string }) {
    this.shared = { sessionId: options.sessionId, cwd: options.cwd, seq: 0, clock: options.start, gitBranch: 'main' }
    this.main = new LaneWriter(this.shared, options.model, undefined, SYSTEM_AND_TOOLS, 12_960)
  }

  get clock(): number {
    return this.shared.clock
  }

  branch(name: string): void {
    this.shared.gitBranch = name
  }

  /** A subagent lane with its own context; it shares the clock, so its records fall between spawn and result. */
  subagent(id: string, model: string, meta: Record<string, unknown>, context: number): LaneWriter {
    const lane = new LaneWriter(this.shared, model, id, context, 0)
    this.subagents.push({ id, lane, meta })
    return lane
  }

  files(): SessionFiles {
    return {
      main: { name: `${this.shared.sessionId}.jsonl`, lines: this.main.lines },
      extra: this.subagents.flatMap(({ id, lane, meta }) => [
        { name: `subagents/agent-${id}.jsonl`, text: `${lane.lines.join('\n')}\n` },
        { name: `subagents/agent-${id}.meta.json`, text: `${JSON.stringify(meta)}\n` },
      ]),
    }
  }

  requests(): number {
    return this.main.requests + this.subagents.reduce((sum, { lane }) => sum + lane.requests, 0)
  }
}
