export type CommandName = 'dev' | 'build' | 'mcp'

const VALUE_FLAGS = new Set(['--port', '--host', '--out-dir'])

export interface ParsedCommand {
  command: CommandName
  path?: string
  pick: boolean
  outDir?: string
  pretty: boolean
  /** Arguments after the program name, without the session positional or `--pick`. */
  userArgs: string[]
  /** Set when more than one positional path was given. Names both paths. */
  error?: string
}

/** DevFrame's default command keeps `[...args]` but drops them. `build` and `mcp` take none. */
export function parseCommand(argv: readonly string[]): ParsedCommand {
  const raw = argv.slice(2)
  let command: CommandName = 'dev'
  let index = 0
  if (raw[0] === 'build' || raw[0] === 'mcp') {
    command = raw[0]
    index = 1
  }
  const userArgs: string[] = command === 'dev' ? [] : [command]
  const positionals: string[] = []
  let pick = false
  let outDir: string | undefined
  let pretty = false
  let options = true

  while (index < raw.length) {
    const arg = raw[index]!
    if (options && arg === '--') {
      options = false
      index += 1
      continue
    }
    if (options && arg.startsWith('-')) {
      if (arg === '--pick') {
        pick = true
        index += 1
        continue
      }
      if (arg === '--pretty') {
        pretty = true
        userArgs.push(arg)
        index += 1
        continue
      }
      if (arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v') {
        userArgs.push(arg)
        index += 1
        continue
      }
      const eq = arg.indexOf('=')
      const flag = eq === -1 ? arg : arg.slice(0, eq)
      const inline = eq === -1 ? undefined : arg.slice(eq + 1)
      if (VALUE_FLAGS.has(flag)) {
        const value = inline !== undefined ? inline : raw[index + 1]
        if (flag === '--out-dir')
          outDir = value
        if (inline !== undefined) {
          userArgs.push(arg)
          index += 1
        }
        else if (value !== undefined) {
          userArgs.push(flag, value)
          index += 2
        }
        else {
          userArgs.push(flag)
          index += 1
        }
        continue
      }
      userArgs.push(arg)
      index += 1
      continue
    }
    positionals.push(arg)
    index += 1
  }

  return {
    command,
    path: positionals[0],
    pick,
    outDir,
    pretty,
    userArgs,
    error: positionals.length > 1
      ? `Two session paths were given: ${positionals[0]} and ${positionals[1]}`
      : undefined,
  }
}

export function programArgv(userArgs: readonly string[]): string[] {
  return [process.argv[0]!, process.argv[1]!, ...userArgs]
}

export function wantsUsage(userArgs: readonly string[]): boolean {
  return userArgs.some(arg => arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v')
}
