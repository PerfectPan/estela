import type { Platform } from '@rivus/agent-kit/platform'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { constants as zlibConstants, zstdDecompressSync } from 'node:zlib'
import * as z from 'zod/mini'
import type { ShellPlatform } from './load-session.ts'

type Decompress = NonNullable<Platform['decompress']>
type PlatformSqlite = NonNullable<Platform['sqlite']>

/** Cap decompressed bytes across all frames of a compressed session file (e.g. `.jsonl.zst`). */
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024

/** Cap canonical `.trace.json` files loaded wholly into memory, in megabytes. */
export const MAX_CANONICAL_TRACE_MB = 256

/** Cap canonical `.trace.json` files loaded wholly into memory. */
export const MAX_CANONICAL_TRACE_BYTES = MAX_CANONICAL_TRACE_MB * 1024 * 1024

const bufferTooLarge = z.object({ code: z.literal('ERR_BUFFER_TOO_LARGE') })
const zstdFrameResult = z.object({
  buffer: z.instanceof(Uint8Array),
  engine: z.object({ bytesWritten: z.number() }),
})

function limitMessage(maxBytes: number): string {
  const megabytes = maxBytes / (1024 * 1024)
  if (Number.isInteger(megabytes) && megabytes >= 1) {
    return `compressed session exceeds the ${megabytes} MB decompression limit`
  }
  return `compressed session exceeds the ${maxBytes}-byte decompression limit`
}

function startsFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false
  }
  const magic = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  return magic === 0xfd2fb528 || (magic & 0xfffffff0) === 0x184d2a50
}

/**
 * Decodes concatenated zstd frames while bounding total decompressed output to `maxBytes`.
 * Mirrors `@rivus/agent-kit/node`'s trailing non-frame suffix break so appended plain bytes do not fail.
 * Stopgap until `@rivus/agent-kit` enforces a decompression output cap natively (#123).
 */
export function decompressZstdBounded(bytes: Uint8Array, maxBytes = MAX_DECOMPRESSED_BYTES): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0
  let totalBytes = 0
  while (offset < bytes.length) {
    const remaining = bytes.subarray(offset)
    if (offset > 0 && !startsFrame(remaining)) {
      break
    }
    const remainingLimit = Math.max(0, maxBytes - totalBytes)
    let raw: unknown
    try {
      raw = zstdDecompressSync(remaining, {
        info: true,
        finishFlush: zlibConstants.ZSTD_e_flush,
        // `maxOutputLength` must be >= 1; +1 rejects any overrun while still allowing an empty trailing frame.
        maxOutputLength: remainingLimit + 1,
      })
    } catch (error) {
      if (z.safeParse(bufferTooLarge, error).success) {
        throw new Error(limitMessage(maxBytes))
      }
      throw error
    }
    const parsed = z.safeParse(zstdFrameResult, raw)
    if (!parsed.success) {
      throw new Error('Zstandard decompression did not return frame metadata')
    }
    const { buffer, engine } = parsed.data
    if (engine.bytesWritten <= 0 || engine.bytesWritten > remaining.length) {
      throw new Error('Zstandard decompression did not consume a valid input range')
    }
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new Error(limitMessage(maxBytes))
    }
    chunks.push(buffer)
    offset += engine.bytesWritten
  }
  return Buffer.concat(chunks)
}

function wrapDecompress(base: Decompress): Decompress {
  return (format, bytes) => {
    const kind: string = format
    return kind === 'zstd' ? decompressZstdBounded(bytes) : base(format, bytes)
  }
}

function wrapSqlite(base: PlatformSqlite): PlatformSqlite {
  return {
    open(path, options) {
      const db = base.open(path, options)
      if (options?.readonly) {
        // Guard against schema triggers/views on read-only opens; query-level limits stay in @rivus/agent-kit (#123).
        db.exec('PRAGMA trusted_schema = OFF; PRAGMA cell_size_check = ON;')
      }
      return db
    },
  }
}

const hardenedPlatforms = new WeakMap<ShellPlatform, ShellPlatform>()

/** Wraps `platform` with bounded zstd decompression and defensive read-only SQLite pragmas. */
export function hardenPlatform(platform: ShellPlatform): ShellPlatform {
  const existing = hardenedPlatforms.get(platform)
  if (existing) {
    return existing
  }
  const wrapped: ShellPlatform = {
    ...platform,
    ...(platform.decompress ? { decompress: wrapDecompress(platform.decompress) } : {}),
    ...(platform.sqlite ? { sqlite: wrapSqlite(platform.sqlite) } : {}),
  }
  hardenedPlatforms.set(platform, wrapped)
  hardenedPlatforms.set(wrapped, wrapped)
  return wrapped
}

/** Creates the server's default Node platform with decompression and SQLite safeguards applied. */
export function createShellPlatform(options?: Parameters<typeof createNodePlatform>[0]): ShellPlatform {
  return hardenPlatform(createNodePlatform(options))
}
