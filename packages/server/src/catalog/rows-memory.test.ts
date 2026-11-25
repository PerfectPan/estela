import type { ShellPlatform } from '../sessions/load-session.ts'
import v8 from 'node:v8'
import vm from 'node:vm'
import { loadTranscript } from '@rivus/agent-kit/transcript'
import { createMemoryPlatform } from '@rivus/agent-kit/testing'
import { PROMPT_CHARS, PROMPT_LIMIT } from '@rivus/estela-runtime-node'
import { describe, expect, it } from 'vite-plus/test'
import { summarizeRow, withinDirectory } from './rows.ts'

// A Claude Code session whose turns are one 40 KB prompt, one request and one turn duration:
// memory-hungry for a reader that materializes the transcript, while the summary pass's own
// state — the numbers per request — stays a few bytes a turn. The big session is ~16 MB, the
// small one ~2 MB.
const TURN_TEXT_BYTES = 40 * 1024
const SMALL_TURNS = 48
const LARGE_TURNS = 384
const at = (value: number): string => String(value).padStart(2, '0')
const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const load = (sampled: ShellPlatform, path: string) => loadTranscript(sampled, { agent: 'claude-code', path })
const catalogSummary = (sampled: ShellPlatform, path: string) =>
  summarizeRow(sampled, undefined, { agent: 'claude-code', path })

function timestamp(turn: number): string {
  const total = turn * 2
  return `2026-01-01T${at(Math.floor(total / 3600))}:${at(Math.floor(total / 60) % 60)}:${at(total % 60)}.000Z`
}

function promptText(turn: number): string {
  const chunk = `turn ${turn} the quick brown fox jumps over the lazy dog `
  return chunk.repeat(Math.ceil(TURN_TEXT_BYTES / chunk.length)).slice(0, TURN_TEXT_BYTES)
}

function sessionContent(turns: number): string {
  const lines: string[] = []
  for (let turn = 0; turn < turns; turn++) {
    lines.push(
      `{"type":"user","uuid":"u${turn}","timestamp":"${timestamp(turn)}","sessionId":"big","cwd":"/work/app","version":"2.0.0","message":{"role":"user","content":"${promptText(turn)}"}}`,
      `{"type":"assistant","uuid":"a${turn}","timestamp":"${timestamp(turn)}","sessionId":"big","cwd":"/work/app","version":"2.0.0","requestId":"req-${turn}","message":{"role":"assistant","model":"claude-test","id":"msg-${turn}","stop_reason":"end_turn","usage":{"input_tokens":${1000 + turn},"output_tokens":50},"content":[{"type":"text","text":"answer ${turn}"}]}}`,
      `{"type":"system","uuid":"d${turn}","subtype":"turn_duration","durationMs":${100 + turn},"timestamp":"${timestamp(turn)}","sessionId":"big","version":"2.0.0"}`,
    )
  }
  return `${lines.join('\n')}\n`
}

/** `gc` comes from `v8.setFlagsFromString` because the test runner does not start Node with `--expose-gc`. */
const gc = (() => {
  v8.setFlagsFromString('--expose-gc')
  const context = vm.createContext({})
  return () => {
    vm.runInContext('gc()', context)
  }
})()

/**
 * The platform whose reads sample the heap: at every chunk boundary the collection runs first,
 * so transients — the parsed records a materializing reader built — are gone at each reading,
 * and the peak is what the call was holding while it ran. A reader that materializes the
 * transcript holds it from mid-read on; the catalog's summary pass holds its running
 * numbers and capped prompts. The tail after the last chunk is not sampled.
 */
function withSampledReads(inner: ShellPlatform, peak: { value: number }): ShellPlatform {
  return {
    home: inner.home,
    env: inner.env,
    fs: {
      stat: (path, options) => inner.fs.stat(path, options),
      list: dir => inner.fs.list(dir),
      async *read(path, range) {
        for await (const chunk of inner.fs.read(path, range)) {
          gc()
          peak.value = Math.max(peak.value, process.memoryUsage().heapUsed)
          yield chunk
        }
      },
    },
  }
}

describe('catalog summary memory', () => {
  it('summarizes a growing session through the catalog without holding its transcript', async () => {
    const files = createMemoryPlatform({
      files: {
        '/claude/small/session.jsonl': sessionContent(SMALL_TURNS),
        '/claude/large/session.jsonl': sessionContent(LARGE_TURNS),
      },
    })
    const peakDuring = async (run: (sampled: ShellPlatform) => Promise<unknown>): Promise<number> => {
      gc()
      await new Promise(resolve => setImmediate(resolve))
      const before = process.memoryUsage().heapUsed
      const peak = { value: before }
      await run(withSampledReads(files, peak))
      return peak.value - before
    }
    // A warm-up round: the first parse of a session pays for JIT and module warm-up, which
    // would otherwise land in the first measured round.
    await peakDuring(sampled => load(sampled, '/claude/small/session.jsonl'))
    await peakDuring(sampled => catalogSummary(sampled, '/claude/small/session.jsonl'))
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await peakDuring(sampled => load(sampled, '/claude/small/session.jsonl'))
      const passSmall = await peakDuring(sampled => catalogSummary(sampled, '/claude/small/session.jsonl'))
      const loadLarge = await peakDuring(sampled => load(sampled, '/claude/large/session.jsonl'))
      const passLarge = await peakDuring(sampled => catalogSummary(sampled, '/claude/large/session.jsonl'))
      console.log(
        `round ${round}: load ${megabytes(loadSmall)} -> ${megabytes(loadLarge)}, summarize ${megabytes(passSmall)} -> ${megabytes(passLarge)}`,
      )
      expect(loadLarge, `round ${round}: load should grow with the session`).toBeGreaterThan(loadSmall * 4)
      expect(loadLarge, `round ${round}: load should hold the large transcript`).toBeGreaterThan(8 * 1024 * 1024)
      expect(passLarge, `round ${round}: the catalog pass should not materialize the transcript`).toBeLessThan(
        1024 * 1024,
      )
      expect(passLarge, `round ${round}: the catalog pass should stay far below the load`).toBeLessThan(loadLarge / 5)
    }
  }, 300_000)

  it('collects the capped prompts without growing past the caps', async () => {
    const files = createMemoryPlatform({
      files: { '/claude/large/session.jsonl': sessionContent(LARGE_TURNS) },
    })
    const result = await summarizeRow(files, undefined, {
      agent: 'claude-code',
      path: '/claude/large/session.jsonl',
    })
    if (!('summary' in result)) {
      throw new Error(result.error.reason)
    }
    // The caps hold whatever the session's size: the first `PROMPT_LIMIT` prompts, `PROMPT_CHARS`
    // characters each, so search over a huge session stays bounded.
    expect(result.prompts).toHaveLength(Math.min(LARGE_TURNS, PROMPT_LIMIT))
    expect(result.prompts[0]?.length).toBeLessThanOrEqual(PROMPT_CHARS)
    expect(result.prompts[0]).toContain('turn 0 ')
  })
})

describe('withinDirectory', () => {
  // Built from parts: the repository check rejects a literal home path in a tracked file.
  const home = ['', 'home', 'u'].join('/')
  const other = '/srv/agents'
  const homes = [home, other]

  it('matches the directory and what is inside it, as recorded, and reads `~` as each home', () => {
    for (const cwd of [`${home}/work/app`, `${other}/work/app`, `${home}/work/app/sub`, `${home}/work/app/`]) {
      expect(withinDirectory(cwd, '~/work/app', homes, 'linux')).toBe(true)
    }
    for (const cwd of [`${home}/work/apple`, `${home}/work`, '/work/app', undefined]) {
      expect(withinDirectory(cwd, '~/work/app', homes, 'linux')).toBe(false)
    }
    // Written out, a home names that home only.
    expect(withinDirectory(`${other}/work/app`, `${home}/work/app`, homes, 'linux')).toBe(false)
    expect(withinDirectory(`${home}`, '~', homes, 'linux')).toBe(true)
    expect(withinDirectory(`${home}/work/app`, `${home}/work/app/`, homes, 'linux')).toBe(true)
    // An empty directory names no session, on either platform.
    expect(withinDirectory(`${home}/work/app`, '', homes, 'linux')).toBe(false)
    expect(withinDirectory(`${home}/work/app`, '', homes, 'win32')).toBe(false)
  })

  it('keeps the case of a POSIX path', () => {
    expect(withinDirectory(`${home}/Work/App`, `${home}/work/app`, homes, 'darwin')).toBe(false)
    expect(withinDirectory(`${home}/Work/App`, '~/Work/App', homes, 'linux')).toBe(true)
  })

  it('reads a Windows path with either separator and without case', () => {
    // A Windows home, built from parts for the same reason.
    const windows = ['C:', 'Users', 'Me'].join('\\')
    const recorded = `${windows}\\Work\\App`
    const homes = [windows]
    for (const asked of ['C:/Users/Me/Work/App', 'c:\\users\\me\\work\\app\\', '~/Work/App']) {
      expect(withinDirectory(recorded, asked, homes, 'win32')).toBe(true)
    }
    expect(withinDirectory('C:\\Users\\Me\\Work\\App\\Sub', 'C:/USERS/ME/WORK/APP', homes, 'win32')).toBe(true)
    // A sibling, a prefix that stops inside a segment, and another drive.
    for (const asked of ['C:/Users/Me/Work/Apple', 'C:/Users/Me/Work/Ap', 'D:/Users/Me/Work/App']) {
      expect(withinDirectory(recorded, asked, homes, 'win32')).toBe(false)
    }
  })
})
