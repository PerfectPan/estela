import { describe, expect, it } from 'vite-plus/test'
import { parseSessionTarget } from './session-target.ts'

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
