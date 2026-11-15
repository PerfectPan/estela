import type { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { redactText } from '@rivus/agent-kit/redact'
import { autocomplete, box, cancel, intro, isCancel, log, outro, spinner, tasks } from '@clack/prompts'

export function isPlainOutput(): boolean {
  return !process.stdout.isTTY || process.env.NO_COLOR !== undefined
}

function consumeEscSequence(text: string, start: number): { end: number; keep: string } {
  const next = text.charCodeAt(start + 1)
  // CSI: keep strictly SGR (`ESC [ <digits/;>* m`), strip cursor/erase/private-mode CSI.
  if (next === 0x5b) {
    let i = start + 2
    while (i < text.length && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x3f) {
      i += 1
    }
    while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) {
      i += 1
    }
    if (i >= text.length) {
      return { end: text.length, keep: '' }
    }
    const final = text.charCodeAt(i)
    if (final >= 0x40 && final <= 0x7e) {
      const seq = text.slice(start, i + 1)
      const isSgr = seq.startsWith('\u001b[') && seq.endsWith('m') && /^[0-9;]*$/.test(seq.slice(2, -1))
      return { end: i + 1, keep: isSgr ? seq : '' }
    }
    return { end: i, keep: '' }
  }
  // OSC (`]`), DCS (`P`), SOS (`X`), PM (`^`), APC (`_`): terminated by BEL, ST (`ESC \`), or C1 ST (`0x9c`).
  if (next === 0x5d || next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
    let i = start + 2
    while (i < text.length) {
      const ch = text.charCodeAt(i)
      if (ch === 0x07 || ch === 0x9c) {
        return { end: i + 1, keep: '' }
      }
      if (ch === 0x1b && i + 1 < text.length && text.charCodeAt(i + 1) === 0x5c) {
        return { end: i + 2, keep: '' }
      }
      i += 1
    }
    return { end: text.length, keep: '' }
  }
  // nF or 2-byte ESC sequence.
  if (next >= 0x20 && next <= 0x2f) {
    let i = start + 2
    while (i < text.length && text.charCodeAt(i) >= 0x20 && text.charCodeAt(i) <= 0x2f) {
      i += 1
    }
    if (i < text.length && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x7e) {
      return { end: i + 1, keep: '' }
    }
    return { end: i, keep: '' }
  }
  if (next >= 0x30 && next <= 0x7e) {
    return { end: start + 2, keep: '' }
  }
  return { end: start + 1, keep: '' }
}

/**
 * Strips OSC, DCS, SOS, PM, APC, non-SGR CSI, C0/C1 controls (except `\n`), and Unicode format/bidi
 * characters while preserving SGR colors and newlines.
 */
function sanitizeTtyKeepSgr(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code === 0x1b) {
      if (i + 1 >= text.length) {
        i += 1
        continue
      }
      const res = consumeEscSequence(text, i)
      out += res.keep
      i = res.end
      continue
    }
    if (code === 0x9b) {
      let j = i + 1
      while (j < text.length && text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f) {
        j += 1
      }
      while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) {
        j += 1
      }
      if (j < text.length && text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e) {
        j += 1
      }
      i = j
      continue
    }
    if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      let j = i + 1
      while (j < text.length) {
        const ch = text.charCodeAt(j)
        if (ch === 0x07 || ch === 0x9c) {
          j += 1
          break
        }
        if (ch === 0x1b && j + 1 < text.length && text.charCodeAt(j + 1) === 0x5c) {
          j += 2
          break
        }
        j += 1
      }
      i = j
      continue
    }
    if (code === 0x0a || (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f))) {
      out += text[i]
    }
    i += 1
  }
  return out.replace(/\p{Cf}+/gu, '')
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

function sanitizeDevframeChunk(text: string): string {
  if (text.includes('auth code') && text.includes('expires at')) {
    return sanitizeTtyKeepSgr(text)
  }
  if (text.includes('[devframe]')) {
    return text
      .split('\n')
      .map(line => (line.includes('[devframe]') ? sanitizeTtyKeepSgr(line) : line))
      .join('\n')
  }
  return text
}

type WriteCallback = (error: Error | null | undefined) => void
/** What follows the chunk in `Writable.write`'s two overloads; Node also accepts a null or undefined encoding. */
type WriteTail = [callback?: WriteCallback] | [encoding: BufferEncoding | null | undefined, callback?: WriteCallback]

function wrap(stream: Writable, strip: boolean, tilde?: (text: string) => string): void {
  const write = stream.write.bind(stream)
  const clean = (text: string): string => {
    const plain = strip ? stripVTControlCharacters(text) : text
    const safe = sanitizeDevframeChunk(plain)
    return tilde ? tilde(safe) : safe
  }
  const touched = (chunk: Uint8Array): boolean => {
    if (strip && chunk.includes(0x1b)) {
      return true
    }
    const buf = Buffer.from(chunk)
    return buf.includes('[devframe]') || (buf.includes('auth code') && buf.includes('expires at'))
  }
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
    process.stdout.write(`estela ${version}\n`)
    return
  }
  intro(`estela ${version}`)
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
    process.stdout.write(`estela ${version}\n`)
    process.stdout.write(`Load: ${await steps.load()}\n`)
    process.stdout.write(`Redact: ${await steps.redact()}\n`)
    process.stdout.write(`Write: ${await steps.write()}\n`)
    return
  }
  intro(`estela ${version}`)
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
  process.stderr.write(`estela: ${line}\n`)
}

/** The file an export wrote: one plain line in a terminal and in a pipe alike. */
export function sayWrote(path: string): void {
  process.stdout.write(`Wrote ${path}\n`)
}
