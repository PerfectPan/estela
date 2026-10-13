import * as z from 'zod/mini'

/**
 * Parses a handler's input as it arrived from the wire (the browser, MCP, any DevFrame client), whatever the
 * handler's parameter type says. Every schema passed here sets `error` on each of its checks, so the first issue's
 * message is the whole message the caller sees; `ErrorType` keeps the class each handler has always thrown.
 */
export function parseInput<T extends z.ZodMiniType>(
  schema: T,
  input: unknown,
  ErrorType: new (message: string) => Error = TypeError,
): z.output<T> {
  const parsed = z.safeParse(schema, input)
  if (!parsed.success) {
    throw new ErrorType(parsed.error.issues[0]?.message ?? 'invalid input')
  }
  return parsed.data
}
