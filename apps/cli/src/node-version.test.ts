import { describe, expect, it } from 'vitest'
import { unsupportedNodeMessage } from './node-version.mjs'

describe('unsupportedNodeMessage', () => {
  it('names Node.js 22.18 for older runtimes', () => {
    expect(unsupportedNodeMessage('20.19.0')).toBe('agent-trace requires Node.js 22.18 or later.')
    expect(unsupportedNodeMessage('22.17.9')).toBe('agent-trace requires Node.js 22.18 or later.')
    expect(unsupportedNodeMessage('22.12.0')).toContain('Node.js 22.18')
  })

  it('accepts 22.18 and newer', () => {
    expect(unsupportedNodeMessage('22.18.0')).toBeNull()
    expect(unsupportedNodeMessage('24.18.0')).toBeNull()
  })
})
