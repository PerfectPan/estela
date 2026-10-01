/** Epoch milliseconds. Missing or unparseable values are `undefined`, never 0. */
export function timeOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms)) {
      return ms
    }
  }
  return undefined
}
