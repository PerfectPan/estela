import type { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { redactText } from '@rivus/agent-kit/redact'
import { autocomplete, box, cancel, intro, isCancel, log, outro, spinner, tasks } from '@clack/prompts'

export function isPlainOutput(): boolean {
  return !process.stdout.isTTY || process.env.NO_COLOR !== undefined
}

/** `~` for the home directory, only on lines that DevFrame logs. */
export function devframeTilde(homeDir: string): (text: string) => string {
  return text =>
    text.includes('[devframe]')
      ? text
          .split('\n')
          .map(line => (line.includes('[devframe]') ? redactText(line, { home: homeDir }) : line))
          .join('\n')
      : text
}

type WriteCallback = (error: Error | null | undefined) => void
/** What follows the chunk in `Writable.write`'s two overloads; Node also accepts a null or undefined encoding. */
type WriteTail = [callback?: WriteCallback] | [encoding: BufferEncoding | null | undefined, callback?: WriteCallback]

function wrap(stream: Writable, strip: boolean, tilde?: (text: string) => string): void {
  const write = stream.write.bind(stream)
  const clean = (text: string): string => {
    const plain = strip ? stripVTControlCharacters(text) : text
    return tilde ? tilde(plain) : plain
  }
  const touched = (chunk: Uint8Array): boolean =>
    (strip && chunk.includes(0x1b)) || (tilde !== undefined && Buffer.from(chunk).includes('[devframe]'))
  stream.write = (chunk: string | Uint8Array, ...tail: WriteTail): boolean => {
    // Known-union narrowing over the two overloads: the callback is a function in either slot,
    // and only a string is an encoding.
    const [first, second] = tail
    const callback = typeof first === 'function' ? first : second
    const encoding = typeof first === 'string' ? first : undefined
    if (typeof chunk !== 'string' && touched(chunk)) {
      // Decoded as UTF-8, so the encoding no longer applies; only the callback is passed on.
      const text = clean(Buffer.from(chunk).toString('utf8'))
      return callback ? write(text, callback) : write(text)
    }
    const out = typeof chunk === 'string' ? clean(chunk) : chunk
    if (encoding) {
      return write(out, encoding, callback)
    }
    return callback ? write(out, callback) : write(out)
  }
}

/**
 * Output filter. In plain mode (not a TTY, or `NO_COLOR`) it strips escape
 * sequences. With `homeDir`, it also replaces the home directory with `~` in
 * DevFrame's `[devframe]` log lines, in plain and TTY mode alike.
 */
export function installPlainFilter(options?: { stderrOnly?: boolean; homeDir?: string }): void {
  const tilde = options?.homeDir ? devframeTilde(options.homeDir) : undefined
  if (options?.stderrOnly) {
    wrap(process.stderr, true, tilde)
    return
  }
  const strip = isPlainOutput()
  if (!strip && !tilde) {
    return
  }
  wrap(process.stdout, strip, tilde)
  wrap(process.stderr, strip, tilde)
}

function supportsOsc8(): boolean {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb') {
    return false
  }
  const program = process.env.TERM_PROGRAM ?? ''
  if (
    program === 'iTerm.app'
    || program === 'WezTerm'
    || program === 'vscode'
    || program === 'ghostty'
    || program === 'Apple_Terminal'
    || program === 'Hyper'
  ) {
    return true
  }
  if (process.env.WT_SESSION || process.env.KONSOLE_VERSION || process.env.VTE_VERSION) {
    return true
  }
  return /^(xterm|screen|tmux|alacritty|kitty)/.test(process.env.TERM ?? '')
}

function osc8(url: string, text: string): string {
  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`
}

/**
 * Guide (2), borders (2), padding (4), and one column for clack rounding the box to an even
 * width, so the URL never wraps (a wrapped OSC 8 link breaks). This also keeps clack's box away
 * from 0 or very few columns, where it would repeat a negative width.
 */
function boxFits(url: string): boolean {
  // `columns` can be unset even on a TTY (no window size); `undefined >= n` is false, so the box is skipped.
  return process.stdout.columns >= url.length + 9
}

export function sayStart(version: string): void {
  if (isPlainOutput()) {
    process.stdout.write(`agent-trace ${version}\n`)
    return
  }
  intro(`agent-trace ${version}`)
}

export function startLoad(): { stop: (events: number) => void; cancel: () => void } {
  if (isPlainOutput()) {
    return {
      stop(events) {
        process.stdout.write(`Loaded ${events} events\n`)
      },
      cancel() {},
    }
  }
  const spin = spinner()
  spin.start('Loading session')
  return {
    stop(events) {
      spin.stop(`Loaded ${events} events`)
    },
    cancel() {
      spin.cancel('Loading failed')
    },
  }
}

export async function sayBuild(
  version: string,
  steps: {
    load: () => Promise<string>
    redact: () => Promise<string>
    write: () => Promise<string>
  },
): Promise<void> {
  if (isPlainOutput()) {
    process.stdout.write(`agent-trace ${version}\n`)
    process.stdout.write(`Load: ${await steps.load()}\n`)
    process.stdout.write(`Redact: ${await steps.redact()}\n`)
    process.stdout.write(`Write: ${await steps.write()}\n`)
    return
  }
  intro(`agent-trace ${version}`)
  await tasks([
    { title: 'Load', task: async () => steps.load() },
    { title: 'Redact', task: async () => steps.redact() },
    { title: 'Write', task: async () => steps.write() },
  ])
  outro('Done')
}

function plainReady(url: string): void {
  process.stdout.write(`Ready: ${url}\n`)
}

export function sayReady(url: string): void {
  if (isPlainOutput()) {
    plainReady(url)
    return
  }
  try {
    if (!boxFits(url)) {
      log.success(`Ready: ${url}`)
      outro('Ready')
      return
    }
    // One URL, inside the box. clack 1.8 measures visible width (OSC 8 bytes count as 0), so the
    // link does not push the right border out; `width: 'auto'` sizes the box to the URL.
    box(supportsOsc8() ? osc8(url, url) : url, 'Ready', { width: 'auto' })
    outro('Ready')
  } catch {
    plainReady(url)
  }
}

/** One warning line; the run continues. */
export function sayWarning(text: string): void {
  if (isPlainOutput()) {
    process.stderr.write(`${text}\n`)
    return
  }
  log.warn(text)
}

export function sayError(cause: string, fix: string): void {
  const text = `${cause}\n${fix}`
  if (isPlainOutput()) {
    process.stderr.write(`${text}\n`)
    return
  }
  log.error(text)
}

/** The picked trace id, or `undefined` when the prompt was cancelled; the prompt prints its own cancel line. */
export async function pickSession(options: { value: string; label: string }[]): Promise<string | undefined> {
  const choice = await autocomplete({
    message: 'Pick a session',
    options,
  })
  if (isCancel(choice)) {
    cancel('Cancelled')
    return undefined
  }
  return choice
}

/** `mcp` is serving: stderr only, because stdout carries the protocol. */
export function sayMcpReady(name: string, transport: string): void {
  process.stderr.write(`[devframe] "${name}" MCP server ready (${transport})\n`)
}

/** A TraceStore warning: one plain stderr line in a terminal and in a pipe alike, so `mcp` stdout stays protocol. */
export function sayStoreWarning(line: string): void {
  process.stderr.write(`agent-trace: ${line}\n`)
}

/** The file an export wrote: one plain line in a terminal and in a pipe alike. */
export function sayWrote(path: string): void {
  process.stdout.write(`Wrote ${path}\n`)
}
