import { describe, expect, it } from 'vite-plus/test'
import { adapterDisplayName, builtinAdapters } from './adapters.ts'

describe('adapterDisplayName', () => {
  it('names every builtin agent by its product name', () => {
    // The kit's OpenCode and ZCode adapters report their id as the display name; the rail and picker show the product.
    expect(adapterDisplayName(builtinAdapters.opencode!)).toBe('OpenCode')
    expect(adapterDisplayName(builtinAdapters.zcode!)).toBe('ZCode')
    expect(adapterDisplayName(builtinAdapters['claude-code']!)).toBe('Claude Code')
    expect(adapterDisplayName(builtinAdapters.dsh!)).toBe('DeepSeek Harness')
  })
})
