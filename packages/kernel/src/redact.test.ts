import { describe, expect, it } from 'vitest'
import { redact } from './redact.ts'

const trace = {
  schema: 'agent-trace/v0' as const,
  host: 'demo',
  session: { id: 's', cwd: '/var/fixture/ada/proj' },
  events: [{
    id: 'e',
    ts: 0,
    kind: 'tool_result' as const,
    payload: { text: 'token sk-demoFAKEFAKEFAKE0123456789 in /var/fixture/ada/notes' },
    original: { raw: 'sk-demoFAKEFAKEFAKE0123456789 /var/fixture/adam stays' },
  }],
}

describe('redact', () => {
  it('strips secret-shaped strings and the injected home directory', () => {
    const out = redact(trace, { homeDir: '/var/fixture/ada' })
    const json = JSON.stringify(out)
    expect(json).not.toContain('sk-demo')
    expect(json).toContain('[redacted]')
    expect(json).toContain('~/proj')
    expect(json).toContain('~/notes')
    expect(json).toContain('/var/fixture/adam stays')
    expect(json).not.toContain('/var/fixture/ada/')
  })
})
