import { describe, expect, it } from 'vite-plus/test'
import { unsupportedNodeMessage } from './node-version.mjs'

const message = 'estela requires Node.js 24 or later.'

describe('unsupportedNodeMessage', () => {
  it('rejects Node 20, 22, and 23', () => {
    expect(unsupportedNodeMessage('20.19.0')).toBe(message)
    expect(unsupportedNodeMessage('22.18.0')).toBe(message)
    expect(unsupportedNodeMessage('23.11.0')).toBe(message)
  })

  it('accepts 24 and later', () => {
    expect(unsupportedNodeMessage('24.0.0')).toBeNull()
    expect(unsupportedNodeMessage('25.1.0')).toBeNull()
  })
})
