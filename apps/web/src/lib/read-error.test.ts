import { describe, expect, it } from 'vite-plus/test'
import { isUnknownFormatGeneration, REPORT_ISSUE_URL } from './read-error.ts'

describe('read-error', () => {
  it('recognizes unknown format generation reasons', () => {
    expect(isUnknownFormatGeneration('unknown format generation')).toBe(true)
    expect(isUnknownFormatGeneration('claude-code: ~/.claude/s.jsonl:1: unknown format generation')).toBe(true)
    expect(isUnknownFormatGeneration('session file does not exist')).toBe(false)
  })

  it('points to the repository issue tracker', () => {
    expect(REPORT_ISSUE_URL).toBe('https://github.com/PerfectPan/estela/issues/new/choose')
  })
})
