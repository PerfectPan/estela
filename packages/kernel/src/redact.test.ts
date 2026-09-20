import { describe, expect, it } from 'vitest'
import { redact } from './redact.ts'

describe('redact', () => {
  it('strips secret-shaped strings from payload and original', () => {
    const out = redact({
      schema: 'agent-trace/v0',
      host: 'demo',
      session: { id: 's' },
      events: [{
        id: 'e',
        ts: 0,
        kind: 'tool_result',
        payload: { text: "token sk-demoFAKESECRET_k2l3m4n5o6p7q8r9s0t1" },
        original: { raw: 'sk-demoFAKESECRET_k2l3m4n5o6p7q8r9s0t1' },
      }],
    })
    expect(JSON.stringify(out)).not.toContain('sk-demo')
    expect(JSON.stringify(out)).toContain('[redacted]')
  })
})
