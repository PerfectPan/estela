/**
 * Side-effect module. Early Node.js 24 releases print one `ExperimentalWarning` when `node:sqlite` loads:
 * 24.0 does, 24.18 does not.
 * A `warning` listener does not stop Node's default printer, so this wraps `process.emitWarning`
 * and drops that one warning (matched by type and message). Every other warning is unchanged.
 *
 * The builtin is loaded while an ES module graph links, before any module in that graph runs.
 * Import this module first and load the code that uses `node:sqlite` afterwards with a dynamic
 * `import()`, as `apps/cli/bin.mjs` does.
 */
/** `emitWarning`'s arguments over its overloads: the warning, then a type, an options object, or a constructor. */
type WarningArgs = [
  warning: string | Error,
  typeOrOptions?: string | NodeJS.EmitWarningOptions | NodeJS.EmitWarningOptions['ctor'],
  ...rest: unknown[],
]

/** Node takes the type of an `Error` warning from its `name`, and otherwise from the argument after it. */
function warningType(warning: WarningArgs[0], typeOrOptions: WarningArgs[1]): string | undefined {
  // Known-union narrowing over the emitWarning overloads.
  if (typeof warning !== 'string') {
    return warning.name
  }
  if (typeOrOptions === undefined || typeof typeOrOptions === 'string') {
    return typeOrOptions
  }
  return typeof typeOrOptions === 'function' ? undefined : typeOrOptions.type
}

export function isSqliteExperimentalWarning(warning: WarningArgs[0], typeOrOptions: WarningArgs[1]): boolean {
  const message = typeof warning === 'string' ? warning : warning.message
  return warningType(warning, typeOrOptions) === 'ExperimentalWarning' && /\bSQLite\b/i.test(message)
}

const original = process.emitWarning.bind(process)
process.emitWarning = (...args: WarningArgs) => {
  if (!isSqliteExperimentalWarning(args[0], args[1])) {
    Reflect.apply(original, process, args)
  }
}
