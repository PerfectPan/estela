import type { Writable } from 'node:stream'

const ANSI = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g

type Clack = typeof import('@clack/prompts')

export function isPlainOutput(): boolean {
  return !process.stdout.isTTY || process.env.NO_COLOR !== undefined
}

export function installPlainFilter(): void {
  if (!isPlainOutput())
    return
  wrap(process.stdout)
  wrap(process.stderr)
}

function wrap(stream: Writable): void {
  const write = stream.write.bind(stream) as typeof stream.write
  stream.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
    const cleaned = strip(chunk)
    if (typeof encoding === 'function')
      return write(cleaned, encoding)
    if (encoding === undefined)
      return callback === undefined ? write(cleaned) : write(cleaned, callback)
    return callback === undefined ? write(cleaned, encoding) : write(cleaned, encoding, callback)
  }) as typeof stream.write
}

function strip(chunk: string | Uint8Array): string | Uint8Array {
  if (typeof chunk === 'string')
    return chunk.replace(ANSI, '')
  return Buffer.from(Buffer.from(chunk).toString('utf8').replace(ANSI, ''))
}

export function supportsOsc8(): boolean {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb')
    return false
  const program = process.env.TERM_PROGRAM ?? ''
  if (program === 'iTerm.app' || program === 'WezTerm' || program === 'vscode' || program === 'ghostty' || program === 'Apple_Terminal' || program === 'Hyper')
    return true
  if (process.env.WT_SESSION || process.env.KONSOLE_VERSION || process.env.VTE_VERSION)
    return true
  return /^(xterm|screen|tmux|alacritty|kitty)/.test(process.env.TERM ?? '')
}

export function osc8(url: string, text: string): string {
  return `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`
}

async function prompts(): Promise<Clack> {
  return import('@clack/prompts')
}

export async function sayStart(version: string): Promise<void> {
  if (isPlainOutput()) {
    process.stdout.write(`agent-trace ${version}\n`)
    return
  }
  const { intro } = await prompts()
  intro(`agent-trace ${version}`)
}

export async function startLoad(): Promise<{ stop: (events: number) => void, cancel: () => void }> {
  if (isPlainOutput()) {
    return {
      stop(events) {
        process.stdout.write(`Loaded ${events} events\n`)
      },
      cancel() {},
    }
  }
  const { spinner } = await prompts()
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

export async function sayBuild(steps: {
  load: () => Promise<string>
  redact: () => Promise<string>
  write: () => Promise<string>
}): Promise<void> {
  if (isPlainOutput()) {
    process.stdout.write(`Load: ${await steps.load()}\n`)
    process.stdout.write(`Redact: ${await steps.redact()}\n`)
    process.stdout.write(`Write: ${await steps.write()}\n`)
    return
  }
  const { tasks } = await prompts()
  await tasks([
    { title: 'Load', task: async () => steps.load() },
    { title: 'Redact', task: async () => steps.redact() },
    { title: 'Write', task: async () => steps.write() },
  ])
}

export async function sayReady(url: string): Promise<void> {
  if (isPlainOutput()) {
    process.stdout.write(`Ready: ${url}\n`)
    return
  }
  const { box, outro } = await prompts()
  const linked = supportsOsc8() ? osc8(url, url) : url
  box(linked, 'Ready')
  outro('Ready')
}

export async function sayError(cause: string, fix: string): Promise<void> {
  const text = `${cause}\n${fix}`
  if (isPlainOutput()) {
    process.stderr.write(`${text}\n`)
    return
  }
  const { log } = await prompts()
  log.error(text)
}

export async function pickSession(options: { value: string, label: string }[]): Promise<string> {
  const { autocomplete, cancel, isCancel } = await prompts()
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
