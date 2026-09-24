import { describe, expect, it } from 'vitest'
import type { TraceIO } from './io.ts'
import { loadTrace } from './load.ts'

function io(stat: TraceIO['stat'], readText: TraceIO['readText'] = async () => '{'): TraceIO {
  return {
    readText,
    async readBytes() {
      return new Uint8Array()
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
    const trace = {
      schema: 'agent-trace/v0',
      host: 'demo',
      session: { id: 's' },
      events: [],
    }
    const loaded = await loadTrace('/tmp/opencode.db#ses_x', [], io(
      async (path) => {
        seen.push(path)
        return path === '/tmp/opencode.db' ? { kind: 'file', size: 2, mtimeMs: 0 } : null
      },
      async () => JSON.stringify(trace),
    ))
    expect(seen).toEqual(['/tmp/opencode.db'])
    expect(loaded.session.id).toBe('s')
  })

  it('reports the ref missing when that file does not exist', async () => {
    const seen: string[] = []
    await expect(loadTrace('/tmp/missing.db#ses_x', [], io(async (path) => {
      seen.push(path)
      return null
    }))).rejects.toThrow('/tmp/missing.db#ses_x does not exist')
    expect(seen).toEqual(['/tmp/missing.db'])
  })
})
