import { describe, expect, it } from 'vite-plus/test'
import process from 'node:process'
import { parseSessionTarget, toKitPath, traceIdOf } from './session-target.ts'

describe('traceIdOf', () => {
  // Pinned: URLs carry these ids, so a saved `#/s/<traceId>` link must keep opening the same session.
  it('hashes agent, path, and session id to the pinned ids', () => {
    expect(traceIdOf({ agent: 'claude-code', path: '/u/me/.claude/projects/p/s.jsonl' })).toBe(
      '61f12b7471b498527580d9be',
    )
    expect(traceIdOf({ agent: 'grok', path: '/u/me/.grok/sessions/a/b.jsonl', sessionId: 's2' })).toBe(
      '8add3d2f035cb7c5c365734c',
    )
  })

  it.runIf(process.platform === 'win32')('gives every separator spelling of one Windows path one id', () => {
    const typed = traceIdOf({ agent: 'claude-code', path: 'C:\\Users\\me\\.claude\\projects\\p\\s.jsonl' })
    expect(traceIdOf({ agent: 'claude-code', path: 'C:\\Users\\me/.claude/projects/p/s.jsonl' })).toBe(typed)
    expect(traceIdOf({ agent: 'claude-code', path: 'C:/Users/me/.claude/projects/p/s.jsonl' })).toBe(typed)
  })
})

describe('toKitPath', () => {
  it('writes Windows separators as / and leaves other systems alone', () => {
    expect(toKitPath('C:\\Users\\me/.claude\\projects', 'win32')).toBe('C:/Users/me/.claude/projects')
    expect(toKitPath('/u/me/a\\b.jsonl', 'linux')).toBe('/u/me/a\\b.jsonl')
    expect(toKitPath('/u/me/a\\b.jsonl', 'darwin')).toBe('/u/me/a\\b.jsonl')
  })
})

describe('parseSessionTarget', () => {
  it('splits at the last # and names no agent', () => {
    expect(parseSessionTarget('/logs/a.jsonl')).toEqual({ path: '/logs/a.jsonl' })
    expect(parseSessionTarget('/logs/a#b.jsonl#s1')).toEqual({ path: '/logs/a#b.jsonl', sessionId: 's1' })
  })

  it('keeps a leading # in the path and drops a trailing one', () => {
    expect(parseSessionTarget('#notes.jsonl')).toEqual({ path: '#notes.jsonl' })
    expect(parseSessionTarget('/logs/a.jsonl#')).toEqual({ path: '/logs/a.jsonl' })
  })
})
