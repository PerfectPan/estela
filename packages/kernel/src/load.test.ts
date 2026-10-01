import { describe, expect, it } from 'vitest'
import type { Trace } from '@rivus/agent-trace-schema'
import type { TraceIO as IO } from './io.ts'
import { loadTrace } from './load.ts'

const canonical: Trace = {
  schema: 'agent-trace',
  host: { id: 'demo' },
  session: { id: 's' },
  capabilities: [],
  agents: [],
  events: [],
  skipped: [],
}
const text = JSON.stringify(canonical)
const bytes = new TextEncoder().encode(text)

function io(stat: IO['stat'], readText: IO['readText'] = async () => text): IO {
  return {
    readText,
    async readBytes() {
      return bytes
    },
    async list() {
      return []
    },
    stat,
    async *lines() {},
  }
}

describe('loadTrace session refs', () => {
  it('stats the file part of a # ref, not the raw path', async () => {
    const seen: string[] = []
    const loaded = await loadTrace(
      '/tmp/opencode.db#ses_x',
      [],
      io(async path => {
        seen.push(path)
        return path === '/tmp/opencode.db' ? { kind: 'file', size: bytes.length, mtimeMs: 0 } : null
      }),
    )
    expect(seen).toEqual(['/tmp/opencode.db'])
    expect(loaded.session.id).toBe('s')
  })

  it('reports the ref missing when that file does not exist', async () => {
    const seen: string[] = []
    await expect(
      loadTrace(
        '/tmp/missing.db#ses_x',
        [],
        io(async path => {
          seen.push(path)
          return null
        }),
      ),
    ).rejects.toThrow('/tmp/missing.db#ses_x does not exist')
    expect(seen).toEqual(['/tmp/missing.db'])
  })
})
