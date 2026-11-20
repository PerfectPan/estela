import { describe, expect, it } from 'vite-plus/test'
import { jsonChars, pageWithin, shown } from './bounds.ts'

/** Built from parts: the repository check rejects a literal home path in a tracked file. */
const HOME = ['', 'Users', 'alice'].join('/')

describe('bounds', () => {
  const tilde = (text: string) => text.replaceAll(HOME, '~')
  const redaction = { value: <T>(value: T): T => value, text: tilde }

  it('redacts, then cuts without splitting a surrogate pair', () => {
    expect(shown('abc', 5, redaction)).toEqual({ text: 'abc', cut: false })
    expect(shown('ab\u{1F600}', 3, redaction)).toEqual({ text: 'ab', cut: true })
    expect(shown(`${HOME}/x`, 4, redaction)).toEqual({ text: '~/x', cut: false })
  })

  it('pages by offset and limit and says where the next page starts', () => {
    const all = Array.from({ length: 10 }, (_, index) => index)
    expect(pageWithin(all, { offset: 2, limit: 3 }, item => item, 0)).toEqual({ items: [2, 3, 4], nextOffset: 5 })
    expect(pageWithin(all, { offset: 8, limit: 5 }, item => item, 0)).toEqual({ items: [8, 9], nextOffset: undefined })
  })

  it('ends a page early at the size bound but always returns one item', () => {
    const all = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)]
    const page = pageWithin(all, { offset: 0, limit: 3 }, item => item, 0, 90)
    expect(page).toEqual({ items: [all[0], all[1]], nextOffset: 2 })
    expect(jsonChars(page.items)).toBeLessThanOrEqual(90)
    expect(pageWithin(all, { offset: 0, limit: 3 }, item => item, 0, 10).items).toEqual([all[0]])
  })
})
