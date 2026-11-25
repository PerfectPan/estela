import { homedir } from 'node:os'
import { win32 } from 'node:path'
import { describe, expect, it, vi } from 'vite-plus/test'
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

  it('keeps every value when two keys redact to the same text, and never lets a key set the prototype', () => {
    const redact = homeRedaction('/u/me')
    const value = {
      '/u/me/sk-aaaaaaaaaaaaaaaa/x.ts': 1,
      '/u/me/sk-bbbbbbbbbbbbbbbb/x.ts': 2,
      // A key that redacts to the name the second one had to take.
      '/u/me/sk-cccccccccccccccc/x.ts#2': 3,
      'sk-dddddddddddddddd': 4,
      'sk-eeeeeeeeeeeeeeee': 5,
      nested: [{ '/u/me/sk-aaaaaaaaaaaaaaaa/y.ts': 'a', '/u/me/sk-ffffffffffffffff/y.ts': 'b' }],
      keep: '/u/metrics/x',
    }
    expect(redact.value(value)).toEqual({
      '~/[redacted]/x.ts': 1,
      '~/[redacted]/x.ts#2': 2,
      '~/[redacted]/x.ts#2#2': 3,
      '[redacted]': 4,
      '[redacted]#2': 5,
      nested: [{ '~/[redacted]/y.ts': 'a', '~/[redacted]/y.ts#2': 'b' }],
      keep: '/u/metrics/x',
    })
    // Shown again, the keys stay as they are: a second pass moves no value to another key.
    expect(redact.value(redact.value(value))).toEqual(redact.value(value))
    // Each home is a pass of its own, so a key that meets another under one home keeps its value there too.
    expect(
      homeRedaction('/u/me', '/srv/agents').value({
        '/u/me/sk-aaaaaaaaaaaaaaaa/a': 1,
        '/srv/agents/sk-aaaaaaaaaaaaaaaa/a': 2,
      }),
    ).toEqual({
      '~/[redacted]/a': 1,
      '~/[redacted]/a#2': 2,
    })
    // `JSON.parse` makes `__proto__` an own property, as a log record can hold one.
    const parsed: Record<string, string> = JSON.parse('{"/u/me/sk-aaaaaaaaaaaaaaaa/__proto__": "/u/me/x"}')
    const shown = redact.value(parsed)
    expect(Object.getPrototypeOf(shown)).toBe(Object.prototype)
    expect(Object.entries(shown)).toEqual([['~/[redacted]/__proto__', '~/x']])
  })

  it('finds a free key for each of many that redact to one text in one step each', () => {
    const redact = homeRedaction('/u/me')
    const count = 3000
    const value = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`/u/me/sk-aaaaaaaa${index}/x.ts`, index]),
    )
    const has = vi.spyOn(Set.prototype, 'has')
    try {
      const shown = redact.value(value)
      expect(Object.values(shown)).toEqual(Array.from({ length: count }, (_, index) => index))
      expect(Object.keys(shown).at(-1)).toBe(`~/[redacted]/x.ts#${count}`)
      // Linear in the number of keys. Starting each search over at `#2` asks once for every key before it.
      expect(has.mock.calls.length).toBeLessThan(count * 100)
    } finally {
      has.mockRestore()
    }
  })

  it('shows a key written with `/` the same on either system', () => {
    // A Windows home, however it is spelled, hides as `~`; the separators after it are the record's own.
    const windows = win32.join('C:\\Users', 'runner')
    const redact = homeRedaction(windows)
    expect(redact.text(`${windows}/sk-aaaaaaaaaaaaaaaa/x.ts`)).toBe('~/[redacted]/x.ts')
    expect(redact.text(win32.join(windows, 'sk-aaaaaaaaaaaaaaaa', 'x.ts'))).toBe('~\\[redacted]\\x.ts')
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
