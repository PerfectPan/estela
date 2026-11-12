import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { Trace } from '@rivus/estela-schema'
import { expect, it } from 'vite-plus/test'
import { createTraceStore } from '../src/store/trace-store.ts'

it.each([
  ['invalid-json', false],
  ['removed', false],
  ['invalid-json', true],
  ['removed', true],
] as const)(
  'marks an original unavailable on a resolver %s failure after stat (compressed %s)',
  async (fault, compressed) => {
    const home = await mkdtemp(join(tmpdir(), 'original-read-'))
    const path = join(home, 'session.jsonl')
    const original = { type: 'user', text: 'original' }
    const text = JSON.stringify(original)
    await writeFile(path, compressed ? zstdCompressSync(Buffer.from(text)) : text)
    const platform = createNodePlatform({ home, env: {} })
    let fail = false
    const trace: Trace = {
      schema: 'estela',
      agent: 'test',
      session: { id: 's' },
      agents: [{ id: 'main' }],
      capabilities: [],
      skipped: [],
      events: [
        {
          id: 'e',
          seq: 0,
          ts: 1,
          kind: 'user',
          payload: { text: 'original' },
          original,
          source: {
            file: path,
            offset: 0,
            length: Buffer.byteLength(text),
            line: 1,
            ...(compressed ? { codec: 'zstd' as const } : {}),
          },
        },
      ],
    }
    const files = {
      ...platform,
      fs: {
        ...platform.fs,
        async *read(file: string, range?: { start: number; end?: number }) {
          if (fail) {
            if (fault === 'removed') {
              await rm(file)
            } else {
              yield new TextEncoder().encode('invalid json')
              return
            }
          }
          yield* platform.fs.read(file, range)
        },
      },
    }
    try {
      const traces = createTraceStore({ platform: files, redacts: false })
      await traces.seed({ key: 's', target: { agent: 'test', path } }, trace)
      fail = true
      const event = await traces.store.event('current', 'e')
      expect(event.original).toBeUndefined()
      expect(event.originalUnavailable).toBeTruthy()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  },
)
