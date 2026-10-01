import { describe, expect, it } from 'vitest'
import { escapeBidi, previewText } from './preview.ts'
import { cutAt, textChunks } from './text-chunks.ts'

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

  it('ends blocks at the next newline, never mid-line', () => {
    const text = 'aaaa\nbbbb\ncccc\ndddd\n'
    const { head, rest } = textChunks(text, 6, 3)
    expect(head).toBe('aaaa\nbbbb\n')
    expect(rest).toEqual(['cccc\n', 'dddd\n'])
    expect(head + rest.join('')).toBe(text)
  })

  it('never splits a surrogate pair when no newline is near', () => {
    const text = 'a😀b'
    // Cutting at 2 would fall between the two halves of the emoji.
    expect(cutAt(text, 2)).toBe(1)
    const { head, rest } = textChunks('x😀😀😀', 2, 2)
    expect([head, ...rest].every(part => !/[\uD800-\uDBFF]$/.test(part))).toBe(true)
    expect(head + rest.join('')).toBe('x😀😀😀')
  })
})
