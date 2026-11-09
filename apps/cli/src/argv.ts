export type CommandName = 'dev' | 'build' | 'mcp' | 'export-atif' | 'export-otlp' | 'dsh-plugin'

const VALUE_FLAGS = new Set(['--port', '--host', '--out-dir', '--out'])

export interface ParsedCommand {
  command: CommandName
  path?: string
  pick: boolean
  noIndex: boolean
  outDir?: string
  /** `--out` of `export-atif` / `export-otlp`: the file to write. */
  outFile?: string
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
  if (raw[0] === 'build' || raw[0] === 'mcp' || raw[0] === 'export-atif' || raw[0] === 'export-otlp') {
    command = raw[0]!
    index = 1
  }
  let dshPluginSub: string | undefined
  if (raw[0] === 'dsh-plugin') {
    command = raw[0]!
    index = 1
    // The subcommand names the action, never a session path.
    if (raw[1] === 'install' || raw[1] === 'uninstall') {
      dshPluginSub = raw[1]
      index = 2
    }
  }
  const userArgs: string[] = command === 'dev' ? [] : [command]
  if (dshPluginSub !== undefined) {
    userArgs.push(dshPluginSub)
  }
  const positionals: string[] = []
  let pick = false
  let noIndex = false
  let outDir: string | undefined
  let outFile: string | undefined
  let options = true
  let error: string | undefined

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
      if (arg === '--no-index') {
        noIndex = true
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
        if (inline !== undefined) {
          if (flag === '--out-dir') {
            outDir = inline
          }
          if (flag === '--out') {
            outFile = inline
          }
          userArgs.push(arg)
          index += 1
          continue
        }
        const next = raw[index + 1]
        if (next === undefined || next.startsWith('-')) {
          error ??= `${flag} needs a value`
          index += 1
          continue
        }
        if (flag === '--out-dir') {
          outDir = next
        }
        if (flag === '--out') {
          outFile = next
        }
        userArgs.push(flag, next)
        index += 2
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
    noIndex,
    outDir,
    outFile,
    userArgs,
    error:
      error
      ?? (positionals.length > 1 ? `Two session paths were given: ${positionals[0]} and ${positionals[1]}` : undefined),
  }
}

export function programArgv(userArgs: readonly string[]): string[] {
  return [process.argv[0]!, process.argv[1]!, ...userArgs]
}

export function wantsUsage(userArgs: readonly string[]): boolean {
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i]!
    if (arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v') {
      return true
    }
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    if (eq === -1 && VALUE_FLAGS.has(flag)) {
      i += 1
    }
  }
  return false
}
