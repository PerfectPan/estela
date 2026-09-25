import { describe, expect, it } from 'vitest'
import { escapeBidi, previewText } from './preview.ts'
import { textChunks } from './text-chunks.ts'

describe('bidi controls', () => {
  it('shows embedding, override, and isolate controls as escapes', () => {
    expect(escapeBidi('rm -rf \u202Etxt.exe')).toBe('rm -rf <U+202E>txt.exe')
    expect(escapeBidi('\u2066a\u2069 \u202A')).toBe('<U+2066>a<U+2069> <U+202A>')
    expect(previewText('ls \u202Dx')).toBe('ls <U+202D>x')
    expect(escapeBidi('plain \u05E2\u05D1\u05E8\u05D9\u05EA')).toBe('plain \u05E2\u05D1\u05E8\u05D9\u05EA')
  })
})

describe('text chunks', () => {
  it('keeps short text whole and splits long text after the cap', () => {
    expect(textChunks('abc', 5, 2)).toEqual({ head: 'abc', rest: [] })
    expect(textChunks('abcdefgh', 3, 2)).toEqual({ head: 'abc', rest: ['de', 'fg', 'h'] })
  })
})
