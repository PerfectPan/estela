import * as z from 'zod/mini'

/** What DevFrame's errors and `Error` instances share. */
const withMessage = z.object({ message: z.string() })

/** The message of anything thrown: an `Error`, a DevFrame error shape `{ message }`, or a value. */
export function messageOf(error: unknown): string {
  return z.safeParse(withMessage, error).data?.message ?? String(error)
}
