import { describe, expect, it } from 'vite-plus/test'
import { homeRedaction } from './redaction.ts'
import { loadErrorMessage, loadFailure, parseReadFailure } from './read-failure.ts'

const me = homeRedaction('/u/me').text

describe('read-failure', () => {
  it('formats UnknownFormatGeneration as agent: file:line: unknown format generation', () => {
    const message = loadErrorMessage(
      { _tag: 'UnknownFormatGeneration', agent: 'claude-code', file: '/u/me/.claude/s.jsonl', line: 3 },
      '/u/me/.claude/s.jsonl',
    )
    expect(message).toBe('claude-code: /u/me/.claude/s.jsonl:3: unknown format generation')
  })

  it('splits UnknownFormatGeneration into redacted file, line, and reason', () => {
    const failure = loadFailure(
      { _tag: 'UnknownFormatGeneration', agent: 'claude-code', file: '/u/me/.claude/s.jsonl', line: 3 },
      me,
      '/u/me/.claude/s.jsonl',
    )
    expect(failure).toEqual({
      file: '~/.claude/s.jsonl',
      line: 3,
      reason: 'unknown format generation',
    })
  })

  it('keeps free-form messages as reason with fallback file', () => {
    expect(parseReadFailure('disk read failed', me, '/u/me/s.jsonl')).toEqual({
      file: '~/s.jsonl',
      reason: 'disk read failed',
    })
  })

  it('maps SessionNotFound to a fixed reason with redacted file', () => {
    expect(loadFailure({ _tag: 'SessionNotFound', path: '/u/me/s.jsonl' }, me, '/u/me/s.jsonl')).toEqual({
      file: '~/s.jsonl',
      reason: 'session file does not exist',
    })
  })
})
