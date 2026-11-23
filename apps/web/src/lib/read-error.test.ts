import { describe, expect, it } from 'vite-plus/test'
import { isUnknownFormatGeneration } from './read-error.ts'

describe('read-error', () => {
  it('recognizes unknown format generation reasons', () => {
    expect(isUnknownFormatGeneration('unknown format generation')).toBe(true)
    expect(isUnknownFormatGeneration('claude-code: ~/.claude/s.jsonl:1: unknown format generation')).toBe(true)
    expect(isUnknownFormatGeneration('session file does not exist')).toBe(false)
  })
})
