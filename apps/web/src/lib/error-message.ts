/** The message of anything thrown: an `Error`, a DevFrame error shape `{ message }`, or a value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message
  return String(error)
}
