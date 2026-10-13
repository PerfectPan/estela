import { describe, expect, it } from 'vitest'
import { sessionRefId } from './session-ref.ts'

describe('sessionRefId', () => {
  // Pinned: URLs carry these ids, so a saved `#/s/<ref>` link must keep opening the same session.
  it('hashes agent, path, and session id to the pinned ids', () => {
    expect(sessionRefId({ agent: 'claude-code', path: '/u/me/.claude/projects/p/s.jsonl' })).toBe(
      '61f12b7471b498527580d9be',
    )
    expect(sessionRefId({ agent: 'grok', path: '/u/me/.grok/sessions/a/b.jsonl', sessionId: 's2' })).toBe(
      '8add3d2f035cb7c5c365734c',
    )
  })
})
