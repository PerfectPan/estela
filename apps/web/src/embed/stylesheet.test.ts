// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { acquireSharedStyles, splitStylesheet, splitTopLevelRules } from './stylesheet.ts'

afterEach(() => {
  for (const style of document.querySelectorAll('style[data-estela-shared]')) {
    style.remove()
  }
})

describe('splitStylesheet', () => {
  it('separates top-level @property rules from shadow rules without losing characters', () => {
    const css = [
      '/*! header comment */',
      '@layer base{*,:before{box-sizing:border-box}}',
      '@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}',
      '.bg{background:url("data:image/svg+xml;utf8,<svg>{}</svg>");content:"@property --fake{}"}',
      '@property --tw-ring-inset{syntax:"*";inherits:false}',
      '@property-other{color:red}',
      '@charset "utf-8";',
      '.esc\\;brace{content:"\\"}";}',
    ].join('\n')

    const rules = splitTopLevelRules(css)
    expect(rules.join('')).toBe(css)

    const split = splitStylesheet(css)
    expect(split.propertyCount).toBe(2)
    expect(split.documentCss).toContain('@property --tw-shadow')
    expect(split.documentCss).toContain('@property --tw-ring-inset')
    expect(split.shadowCss).not.toContain('@property --tw-shadow')
    expect(split.shadowCss).not.toContain('@property --tw-ring-inset')
    expect(split.shadowCss).toContain('@property-other{color:red}')
    expect(split.shadowCss).toContain('content:"@property --fake{}"')
    expect(split.shadowCss).toContain('url("data:image/svg+xml;utf8,<svg>{}</svg>")')
    expect(split.documentCss.length + split.shadowCss.length).toBe(css.length)
  })

  it('handles unclosed comments and strings without hanging', () => {
    const css = '/* unclosed comment'
    expect(splitTopLevelRules(css)).toEqual([css])
    expect(splitStylesheet(css)).toEqual({ documentCss: '', shadowCss: css, propertyCount: 0 })
  })
})

describe('acquireSharedStyles', () => {
  it('keeps one <style data-estela-shared> per document and removes it when the last holder releases', () => {
    const css = '@property --a{syntax:"*";inherits:false}'
    const releaseFirst = acquireSharedStyles(document, css)
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(1)
    expect(document.querySelector('style[data-estela-shared]')?.textContent).toBe(css)

    const releaseSecond = acquireSharedStyles(document, css)
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(1)

    // Calling release twice on the first holder must not drop the second holder's reference.
    releaseFirst()
    releaseFirst()
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(1)

    releaseSecond()
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(0)

    // Re-acquiring after full cleanup inserts a fresh shared stylesheet.
    const releaseThird = acquireSharedStyles(document, css)
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(1)
    releaseThird()
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(0)
  })

  it('does not insert a style element when documentCss is empty', () => {
    const release = acquireSharedStyles(document, '')
    expect(document.querySelectorAll('style[data-estela-shared]').length).toBe(0)
    release()
  })
})
