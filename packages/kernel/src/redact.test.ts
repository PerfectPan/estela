import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { redact } from './redact.ts'

const users = '/Users'
const linuxHomes = '/home'
const home = `${users}/alice`
const source = { file: 'fixture.json', offset: 0, length: 1, line: 1 }

function event(partial: Partial<TraceEvent> & Pick<TraceEvent, 'kind' | 'payload'>): TraceEvent {
  return {
    id: 'e',
    seq: 0,
    ts: 0,
    source,
    original: null,
    ...partial,
  }
}

function trace(events: TraceEvent[], session: Trace['session'] = { id: 's' }): Trace {
  return {
    schema: 'agent-trace',
    host: { id: 'demo' },
    session,
    capabilities: [],
    agents: [],
    events,
    skipped: [],
  }
}

function textOf(body: string, homeDir: string): string {
  return JSON.stringify(redact(trace([event({ kind: 'user', payload: { text: body } })]), { homeDir }))
}

describe('redact', () => {
  it('strips secret-shaped strings and the injected home directory', () => {
    const out = redact(trace([event({
      kind: 'tool_result',
      payload: { text: 'token sk-demoFAKEFAKEFAKE0123456789 in /var/fixture/ada/notes' },
      original: { raw: 'sk-demoFAKEFAKEFAKE0123456789 /var/fixture/adam stays' },
    })], { id: 's', cwd: '/var/fixture/ada/proj' }), { homeDir: '/var/fixture/ada' })
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
    expect(textOf(`${home}é`, home)).toContain(`${home}é`)
    expect(textOf(`${home.toUpperCase()}/x`, home)).toContain('~/x')
    expect(textOf(`${home.toUpperCase()}/x`, home)).not.toContain(home.toUpperCase())
  })

  it('replaces the home directory after any character, without its leading slash, and JSON-escaped', () => {
    const bare = home.slice(1)
    const escaped = home.replaceAll('/', '\\/')
    expect(textOf(`diff --git a${home}/x b${home}/x`, home)).toContain('diff --git a~/x b~/x')
    expect(textOf(`--- a${home}/x`, home)).not.toContain('alice')
    expect(textOf(`file://${home}/x`, home)).toContain('file://~/x')
    expect(textOf(`cd ${bare}/x`, home)).toContain('cd ~/x')
    expect(textOf(`"${bare.toUpperCase()}/x"`, home)).not.toMatch(/alice/i)
    const raw = redact({ text: `{"cwd":"${escaped}\\/x"}` }, { homeDir: home })
    expect(raw.text).toBe('{"cwd":"~\\/x"}')
    // The same segment rules as the literal form.
    expect(textOf(`${bare}x ${escaped}.bak`, home)).toContain(`${bare}x`)
    expect(redact({ text: `${escaped}.bak` }, { homeDir: home }).text).toBe(`${escaped}.bak`)
    // A longer name before the slash-less form is another path, not the home directory.
    expect(textOf(`My${bare}/x`, home)).toContain(`My${bare}/x`)
  })

  it('replaces dash-encoded and percent-encoded home directories', () => {
    const dash = home.replaceAll('/', '-')
    const encoded = home.replaceAll('/', '%2F')
    expect(textOf(`proj ${dash}-code file`, home)).toContain('proj ~-code file')
    expect(textOf(`proj ${dash}-code file`, home)).not.toContain('alice')
    expect(textOf(`dir ${encoded}%2Fsessions`, home)).toContain('dir ~%2Fsessions')
    expect(textOf(`dir ${encoded.toLowerCase()}%2Fsessions`, home)).not.toContain('alice')
    const key = `${dash}-proj`
    const out = redact(trace([event({
      kind: 'tool_result',
      payload: { [key]: `${encoded}/updates.jsonl` },
    })]), { homeDir: home })
    const json = JSON.stringify(out)
    expect(json).not.toContain('alice')
    expect(json).toContain('~-proj')
    expect(json).toContain('~/updates.jsonl')
  })

  it('replaces the Claude slug and percent forms of any home name', () => {
    const cases = [
      { home: `${users}/john.doe`, dash: '-Users-john-doe', encoded: '%2FUsers%2Fjohn.doe', name: 'john' },
      { home: `${linuxHomes}/j_smith`, dash: '-home-j-smith', encoded: '%2Fhome%2Fj_smith', name: 'smith' },
      { home: `${users}/zoë`, dash: '-Users-zo-', encoded: '%2FUsers%2Fzo%C3%AB', name: 'zo' },
    ]
    for (const item of cases) {
      const out = JSON.stringify(redact(trace([event({
        kind: 'tool_result',
        payload: {
          [`${item.dash}-proj`]: `${item.dash}-proj/x.jsonl`,
          dir: `${item.encoded}%2Fproj`,
          lower: `${item.encoded.toLowerCase()}%2Fproj`,
        },
      })]), { homeDir: item.home }))
      expect(out, item.home).not.toContain(item.name)
      expect(out).toContain('~-proj/x.jsonl')
      expect(out).toContain('~%2Fproj')
    }
  })

  it('redacts home paths used as object keys', () => {
    const key = `${home}/proj/a.ts`
    const out = redact(trace([event({
      kind: 'tool_result',
      payload: { [key]: 1 },
    })]), { homeDir: home })
    const json = JSON.stringify(out)
    expect(json).not.toContain(home)
    expect(json).toContain('~/proj/a.ts')
  })
})
