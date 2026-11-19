import * as z from 'zod/mini'

// `createFromSource(...).export()` is typed as `Promise<unknown>`; parse the shape once at this boundary.
const i18nSearchExportSchema = z.object({
  type: z.literal('i18n'),
  data: z.record(z.string(), z.unknown()),
})

/** Parses Fumadocs' `export()` result as the per-locale map produced by `localeMap`. */
export function i18nSearchData(value: unknown): Record<string, unknown> {
  const parsed = z.safeParse(i18nSearchExportSchema, value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const detail = issue ? `${issue.path.join('.') || 'value'}: ${issue.message}` : 'invalid input'
    throw new Error(`expected per-language search export (${detail})`)
  }
  return parsed.data.data
}
