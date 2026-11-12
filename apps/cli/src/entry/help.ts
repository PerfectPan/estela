import { printHelp, type Help, type RoutePath } from '@bomb.sh/router'

const PROGRAM = 'estela'

/**
 * Help for the route the command line selected, from the router's printer with three corrections.
 * The printer titles a nested route by its path alone (`build`), so the route goes in renamed to the
 * full command, as a root. It writes every positional as required (`<SESSION>`) and puts the dev
 * server's session before `[COMMAND]`, where `app.ts` refuses it, so the usage lines are written here.
 */
export function helpText(intent: Help<RoutePath>): string {
  const command = [PROGRAM, ...intent.path].join(' ')
  const usage =
    intent.path.length === 0
      ? [`${command} [OPTIONS] [SESSION]`, `${command} <COMMAND> [OPTIONS] [SESSION]`]
      : [`${command} [OPTIONS] [SESSION]`]
  return printHelp({ ...intent, path: [], definition: { ...intent.definition, name: command } })
    .replace(/^Usage:\n.*$/m, ['Usage:', ...usage.map(line => `  ${line}`)].join('\n'))
    .replaceAll('<SESSION>', '[SESSION]')
}

export function versionText(packageVersion: string): string {
  return `${PROGRAM} ${packageVersion}`
}
