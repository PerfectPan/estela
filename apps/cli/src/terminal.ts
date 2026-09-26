import type { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { autocomplete, box, cancel, intro, isCancel, log, outro, spinner, tasks } from '@clack/prompts'

export function isPlainOutput(): boolean {
  return !process.stdout.isTTY || process.env.NO_COLOR !== undefined
}

export function installPlainFilter(options?: { stderrOnly?: boolean }): void {
  if (options?.stderrOnly) {
    wrap(process.stderr)
    return
  }
  if (!isPlainOutput())
    return
  wrap(process.stdout)
  wrap(process.stderr)
}

function callbackArg(rest: readonly unknown[]): [] | [(error?: Error | null) => void] {
  for (let i = rest.length - 1; i >= 0; i--) {
    const item = rest[i]
    if (typeof item === 'function')
      return [item as (error?: Error | null) => void]
  }
  return []
}

function wrap(stream: Writable): void {
  const write = stream.write.bind(stream) as typeof stream.write
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    if (typeof chunk !== 'string') {
      if (!chunk.includes(0x1b))
        return write(chunk, ...(rest as []))
      const text = Buffer.from(chunk).toString('utf8')
      return write(stripVTControlCharacters(text), ...callbackArg(rest))
    }
    return write(stripVTControlCharacters(chunk), ...(rest as []))
  }) as typeof stream.write
}

function supportsOsc8(): boolean {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb')
    return false
  const program = process.env.TERM_PROGRAM ?? ''
  if (program === 'iTerm.app' || program === 'WezTerm' || program === 'vscode' || program === 'ghostty' || program === 'Apple_Terminal' || program === 'Hyper')
    return true
  if (process.env.WT_SESSION || process.env.KONSOLE_VERSION || process.env.VTE_VERSION)
    return true
  return /^(xterm|screen|tmux|alacritty|kitty)/.test(process.env.TERM ?? '')
}

function osc8(url: string, text: string): string {
  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`
}

/** Borders plus padding. `columns` of 0 is falsy; under 10 clack's box repeats a negative width. */
function boxFits(url: string): boolean {
  const columns = process.stdout.columns
  if (!columns || columns < 10)
    return false
  return columns >= url.length + 8
}

export function sayStart(version: string): void {
  if (isPlainOutput()) {
    process.stdout.write(`agent-trace ${version}\n`)
    return
  }
  intro(`agent-trace ${version}`)
}

export function startLoad(): { stop: (events: number) => void, cancel: () => void } {
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

export async function sayBuild(version: string, steps: {
  load: () => Promise<string>
  redact: () => Promise<string>
  write: () => Promise<string>
}): Promise<void> {
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
    // clack measures the whole string. OSC 8 bytes inside the box push the right border out.
    box(url, 'Ready')
    if (supportsOsc8())
      process.stdout.write(`${osc8(url, url)}\n`)
    outro('Ready')
  }
  catch {
    plainReady(url)
  }
}

export function sayError(cause: string, fix: string): void {
  const text = `${cause}\n${fix}`
  if (isPlainOutput()) {
    process.stderr.write(`${text}\n`)
    return
  }
  log.error(text)
}

export async function pickSession(options: { value: string, label: string }[]): Promise<string> {
  const choice = await autocomplete({
    message: 'Pick a session',
    options,
  })
  if (isCancel(choice)) {
    cancel('Cancelled')
    process.exit(1)
  }
  return String(choice)
}
