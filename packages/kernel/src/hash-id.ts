/**
 * Deterministic hex ids for OTLP export, without `node:crypto`: FNV-1a over the
 * UTF-16 code units of the key, with per-position seeds so the four 32-bit words
 * of a trace id are independent. Same key in, same id out; a session and its
 * spans keep their ids across exports.
 */
const FNV_PRIME = 0x01000193

function fnv1a(key: string, seed: number): number {
  let hash = seed | 0
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

const SEEDS = [0x811c9dc5, 0x01935a51, 0x1003f0e1, 0x0ffee2d3] as const

function word(key: string, position: number): string {
  return fnv1a(key, SEEDS[position]!).toString(16).padStart(8, '0')
}

/** A 128-bit OTLP trace id for `key` (hex, 32 characters). */
export function traceIdHex(key: string): string {
  return `${word(key, 0)}${word(key, 1)}${word(key, 2)}${word(key, 3)}`
}

/** A 64-bit OTLP span id for `key` (hex, 16 characters). */
export function spanIdHex(key: string): string {
  return `${word(key, 0)}${word(key, 1)}`
}
