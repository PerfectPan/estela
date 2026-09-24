import { describe, expect, it } from 'vitest'
import { redact } from './redact.ts'

const users = '/Users'
const home = `${users}/alice`

function textOf(body: string, homeDir: string): string {
  const out = redact({
    schema: 'agent-trace/v0',
    host: 'demo',
    session: { id: 's' },
    events: [{
      id: 'e',
      ts: 0,
      kind: 'user',
      payload: { text: body },
      original: null,
    }],
  }, { homeDir })
  return JSON.stringify(out)
}

describe('redact', () => {
  it('strips secret-shaped strings and the injected home directory', () => {
    const out = redact({
      schema: 'agent-trace/v0',
      host: 'demo',
      session: { id: 's', cwd: '/var/fixture/ada/proj' },
      events: [{
        id: 'e',
        ts: 0,
        kind: 'tool_result',
        payload: { text: 'token sk-demoFAKEFAKEFAKE0123456789 in /var/fixture/ada/notes' },
        original: { raw: 'sk-demoFAKEFAKEFAKE0123456789 /var/fixture/adam stays' },
      }],
    }, { homeDir: '/var/fixture/ada' })
    const json = JSON.stringify(out)
    expect(json).not.toContain('sk-demo')
    expect(json).toContain('[redacted]')
    expect(json).toContain('~/proj')
    expect(json).toContain('~/notes')
    expect(json).toContain('/var/fixture/adam stays')
    expect(json).not.toContain('/var/fixture/ada/')
  })

  it('replaces the home directory unless the next character continues the segment', () => {
    expect(textOf(`I am in ${home}.`, home)).toContain('I am in ~.')
    expect(textOf(`PATH=${home}:/usr/bin`, home)).toContain('PATH=~:/usr/bin')
    expect(textOf(`(${home})`, home)).toContain('(~)')
    expect(textOf(`home=${home};`, home)).toContain('home=~;')
    expect(textOf(`${home}x`, home)).toContain(`${home}x`)
    expect(textOf(`${home}.bak`, home)).toContain(`${home}.bak`)
  })
})
