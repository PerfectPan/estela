import { homedir } from 'node:os'
import { describe, expect, it } from 'vite-plus/test'
import { homeRedaction, serverRedaction } from './redaction.ts'

describe('home redaction', () => {
  it('hides one home as the kit does, in text and in every string of a value', () => {
    const redact = homeRedaction('/u/me')
    expect(redact.text('open /u/me/notes.md with sk-abcdefghijklmnop')).toBe('open ~/notes.md with [redacted]')
    expect(redact.value({ ['/u/me/key']: ['/u/me/notes.md', 1, undefined], keep: '/u/metrics/x' })).toEqual({
      '~/key': ['~/notes.md', 1, undefined],
      keep: '/u/metrics/x',
    })
  })

  it('hides every home it is given, in text and in a value', () => {
    const redact = homeRedaction('/u/me', '/srv/agents')
    expect(redact.text('open /u/me/notes.md and /srv/agents/run.log')).toBe('open ~/notes.md and ~/run.log')
    const value = { text: 'a\\/u\\/me\\/a.json and file:///srv/agents/b.json', nested: [{ path: '/srv/agents/c' }] }
    expect(redact.value(value)).toEqual({ text: 'a~\\/a.json and file://~/b.json', nested: [{ path: '~/c' }] })
    // A longer name that starts with a home is another directory.
    expect(redact.text('/u/metrics /srv/agents-old')).toBe('/u/metrics /srv/agents-old')
    expect(value.text).toBe('a\\/u\\/me\\/a.json and file:///srv/agents/b.json')
  })

  it('hides the longer of two nested homes first, whatever order they come in', () => {
    const users = '/srv/users'
    const alice = '/srv/users/alice'
    const text = 'in /srv/users/alice/notes and /srv/users/bob/notes, root /srv/users'
    for (const redact of [homeRedaction(users, alice), homeRedaction(alice, users)]) {
      expect(redact.text(text)).toBe('in ~/notes and ~/bob/notes, root ~')
      expect(redact.value({ [`${alice}/notes`]: `${users}/bob`, nested: [{ path: alice }] })).toEqual({
        '~/notes': '~/bob',
        nested: [{ path: '~' }],
      })
    }
  })

  it('gives a server the platform home and the process home', () => {
    const redact = serverRedaction('/u/platform')
    expect(redact.text(`from /u/platform/a.json and ${homedir()}/.ssh/id_rsa`)).toBe('from ~/a.json and ~/.ssh/id_rsa')
  })
})
