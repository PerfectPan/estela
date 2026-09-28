/**
 * Side-effect module. Node.js 22 prints one `ExperimentalWarning` when `node:sqlite` loads (D7).
 * A `warning` listener does not stop Node's default printer, so this wraps `process.emitWarning`
 * and drops that one warning (matched by type and message). Every other warning is unchanged.
 *
 * The builtin is loaded while an ES module graph links, before any module in that graph runs.
 * Import this module first and load the code that uses `node:sqlite` afterwards with a dynamic
 * `import()`, as `apps/cli/bin.mjs` does.
 */
export function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  const name = typeof warning === 'string'
    ? (typeof typeOrOptions === 'string' ? typeOrOptions : (typeOrOptions as { type?: unknown } | undefined)?.type)
    : (warning as { name?: unknown } | undefined)?.name
  const message = typeof warning === 'string' ? warning : (warning as { message?: unknown } | undefined)?.message
  return name === 'ExperimentalWarning' && typeof message === 'string' && /\bSQLite\b/i.test(message)
}

const original = process.emitWarning.bind(process) as (...args: unknown[]) => void
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (!isSqliteExperimentalWarning(warning, rest[0]))
    original(warning, ...rest)
}) as typeof process.emitWarning
