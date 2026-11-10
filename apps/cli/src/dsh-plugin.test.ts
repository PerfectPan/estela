import { parse } from 'yaml'
import { describe, expect, it } from 'vite-plus/test'
import { withDshTracePatch, withoutDshTracePatch } from './dsh-plugin.ts'

const START = '# agent-trace-dsh-plugin:start'
const END = '# agent-trace-dsh-plugin:end'

describe('dsh-plugin patch merge', () => {
  it('merges an empty flow array while retaining comments, and rejects nonempty flow arrays before editing', () => {
    const merged = withDshTracePatch('# keep\n[] # note\n', '/p/plugin.mjs')
    expect(parse(merged)).toEqual([{ insert: [{ id: 'agent-trace-dsh', name: '/p/plugin.mjs' }] }])
    expect(merged).toContain('# keep')
    expect(merged).toContain('# note')
    expect(parse(withoutDshTracePatch(merged))).toEqual([])
    expect(withoutDshTracePatch(merged)).toContain('# keep')
    expect(() => withDshTracePatch('[{ remove: foreign }]\n', '/p/plugin.mjs')).toThrow('nonempty flow-style')
    expect(() => withDshTracePatch('foreign: mapping\n', '/p/plugin.mjs')).toThrow('must be a YAML sequence')
  })

  it('preserves foreign indentation and trailing whitespace exactly', () => {
    const foreign = '  - insert:\n      - name: foreign\n\n'
    const merged = withDshTracePatch(foreign, '/p/plugin.mjs')
    expect(parse(merged)).toHaveLength(2)
    expect(withoutDshTracePatch(merged)).toBe(foreign)
  })

  it('appends its marker block to an empty patch and merges idempotently', () => {
    const once = withDshTracePatch('', '/opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs')
    expect(once).toContain(START)
    expect(once).toContain('name: "/opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs"')
    expect(once).toContain(END)
    const twice = withDshTracePatch(once, '/opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs')
    expect(twice).toBe(once)
    // A moved plugin file replaces its entry in place, and the foreign lines around it stay.
    const moved = withDshTracePatch('- remove: keep-me\n', '/elsewhere/agent-trace-dsh.mjs')
    expect(moved).toContain('keep-me')
    expect(moved).toContain('name: "/elsewhere/agent-trace-dsh.mjs"')
    expect(withDshTracePatch(moved, '/elsewhere/agent-trace-dsh.mjs')).toBe(moved)
  })

  it.each([
    START + '\nforeign: true\n',
    END + '\n',
    END + '\n' + START + '\n',
    START + '\n' + START + '\n' + END + '\n',
    START + '\n' + END + '\n' + END + '\n',
  ])('refuses ambiguous markers without rewriting other plugins: %s', input => {
    expect(() => withDshTracePatch(input, '/p/plugin.mjs')).toThrow('invalid agent-trace plugin markers')
    expect(() => withoutDshTracePatch(input)).toThrow('invalid agent-trace plugin markers')
  })

  it('quotes paths with YAML punctuation and preserves CRLF blocks', () => {
    const path = '/dsh/home: #1/plugin.mjs'
    const merged = withDshTracePatch('', path)
    expect(merged).toContain('name: ' + JSON.stringify(path))
    const crlf = ('- remove: before\n' + merged + '- remove: after\n').replaceAll('\n', '\r\n')
    expect(withoutDshTracePatch(crlf)).toContain('remove: after')
  })

  it('removes its block and nothing else, and empties to a deleted patch', () => {
    const body = '- remove: before\n\n' + withDshTracePatch('', '/p/agent-trace-dsh.mjs') + '- remove: after\n'
    const removed = withoutDshTracePatch(body)
    expect(removed).toContain('remove: before')
    expect(removed).toContain('remove: after')
    expect(removed).not.toContain(START)
    expect(removed).not.toContain('agent-trace-dsh.mjs')
    expect(withoutDshTracePatch(withDshTracePatch('', '/p/agent-trace-dsh.mjs'))).toBe('')
    // A body without the block passes through unchanged.
    expect(withoutDshTracePatch('- remove: keep-me\n')).toBe('- remove: keep-me\n')
  })
})
