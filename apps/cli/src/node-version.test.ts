import { describe, expect, it } from 'vitest'
import { unsupportedNodeMessage } from './node-version.mjs'

const message = 'agent-trace requires Node.js 22.18 or later.'

describe('unsupportedNodeMessage', () => {
  it('rejects Node 20, 22 before 22.18, and 23 before 23.6', () => {
    expect(unsupportedNodeMessage('20.19.0')).toBe(message)
    expect(unsupportedNodeMessage('22.9.0')).toBe(message)
    expect(unsupportedNodeMessage('22.17.0')).toBe(message)
    expect(unsupportedNodeMessage('23.3.0')).toBe(message)
  })

  it('accepts 22.18, 23.6, and 24', () => {
    expect(unsupportedNodeMessage('22.18.0')).toBeNull()
    expect(unsupportedNodeMessage('23.6.0')).toBeNull()
    expect(unsupportedNodeMessage('24.0.0')).toBeNull()
  })
})
