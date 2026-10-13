import { describe, expect, it } from 'vite-plus/test'
import { messageOf } from './error-message.ts'

describe('messageOf', () => {
  it('reads the message of an Error, of a DevFrame error shape, and of nothing else', () => {
    expect(messageOf(new TypeError('bad ref'))).toBe('bad ref')
    expect(messageOf({ message: 'from the server', code: 'DF0043' })).toBe('from the server')
    expect(messageOf({ message: 5 })).toBe('[object Object]')
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf(undefined)).toBe('undefined')
  })
})
