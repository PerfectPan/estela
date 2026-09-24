/**
 * Node.js 22 prints one `ExperimentalWarning` when `node:sqlite` loads (D7).
 * A `warning` listener does not stop Node's default printer, so this wraps
 * `process.emitWarning` and drops that one warning. Every other warning,
 * including other experimental features, is emitted unchanged.
 *
 * The builtin is loaded while an ES module graph links, before any module in
 * that graph runs. Import this module first and load the code that uses
 * `node:sqlite` afterwards with a dynamic `import()`, as `apps/cli/bin.mjs` does.
 */
let installed = false

type EmitWarning = typeof process.emitWarning

export function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  const name = typeof warning === 'string'
    ? (typeof typeOrOptions === 'string' ? typeOrOptions : (typeOrOptions as { type?: unknown } | undefined)?.type)
    : (warning as { name?: unknown } | undefined)?.name
  const message = typeof warning === 'string' ? warning : (warning as { message?: unknown } | undefined)?.message
  return name === 'ExperimentalWarning' && typeof message === 'string' && /\bSQLite\b/i.test(message)
}

export function suppressSqliteExperimentalWarning(): void {
  if (installed)
    return
  installed = true
  if (Number(process.versions.node.split('.')[0]) !== 22)
    return
  const original: EmitWarning = process.emitWarning.bind(process)
  const filtered = ((warning: string | Error, ...rest: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, rest[0]))
      return
    ;(original as (...args: unknown[]) => void)(warning, ...rest)
  }) as EmitWarning
  process.emitWarning = filtered
}

suppressSqliteExperimentalWarning()
