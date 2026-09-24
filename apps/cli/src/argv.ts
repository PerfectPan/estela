export type CommandName = 'dev' | 'build' | 'mcp'

const VALUE_FLAGS = new Set(['--port', '--host', '--out-dir'])

export interface ParsedCommand {
  command: CommandName
  path?: string
  pick: boolean
  help: boolean
  version: boolean
  outDir?: string
  /** Arguments after the program name, without the session positional or `--pick`. */
  userArgs: string[]
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
  let path: string | undefined
  let pick = false
  let help = false
  let version = false
  let outDir: string | undefined

  while (index < raw.length) {
    const arg = raw[index]!
    if (arg === '--') {
      index += 1
      continue
    }
    if (arg === '--pick') {
      pick = true
      index += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      help = true
      userArgs.push(arg)
      index += 1
      continue
    }
    if (arg === '--version' || arg === '-v') {
      version = true
      userArgs.push(arg)
      index += 1
      continue
    }
    if (arg.startsWith('-')) {
      const eq = arg.indexOf('=')
      const flag = eq === -1 ? arg : arg.slice(0, eq)
      if (flag === '--out-dir' && eq !== -1)
        outDir = arg.slice(eq + 1)
      userArgs.push(arg)
      if (VALUE_FLAGS.has(flag) && eq === -1) {
        index += 1
        const value = raw[index]
        if (value !== undefined) {
          if (flag === '--out-dir')
            outDir = value
          userArgs.push(value)
        }
      }
      index += 1
      continue
    }
    if (path === undefined)
      path = arg
    index += 1
  }

  return { command, path, pick, help, version, outDir, userArgs }
}

export function programArgv(userArgs: readonly string[]): string[] {
  return [process.argv[0] ?? 'node', process.argv[1] ?? 'bin.mjs', ...userArgs]
}
