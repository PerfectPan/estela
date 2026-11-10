import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { Trace } from '@rivus/agent-trace-schema'
import { expect, it } from 'vite-plus/test'
import { createTraceStore } from '../src/trace-store.ts'

it.each(['invalid-json', 'removed'] as const)(
  'marks an original unavailable on a resolver %s failure after stat',
  async fault => {
    const home = await mkdtemp(join(tmpdir(), 'original-read-'))
    const path = join(home, 'session.jsonl')
    const original = { type: 'user', text: 'original' }
    const text = JSON.stringify(original)
    await writeFile(path, text)
    const platform = createNodePlatform({ home, env: {} })
    let fail = false
    const trace: Trace = {
      schema: 'agent-trace',
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
          source: { file: path, offset: 0, length: Buffer.byteLength(text), line: 1 },
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
