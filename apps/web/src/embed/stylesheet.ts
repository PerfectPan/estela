const SHARED_STYLE_ATTR = 'data-estela-shared'
const PROPERTY_RULE = /^@property(?:\s|$)/

export interface SplitStylesheet {
  /** Top-level `@property` rules, placed once at document level so browsers apply their initial values inside shadow roots. */
  documentCss: string
  /** All remaining rules, placed inside each element's shadow root. */
  shadowCss: string
  /** Number of top-level `@property` rules moved to `documentCss`. */
  propertyCount: number
}

/**
 * Splits a CSS stylesheet into top-level slices without dropping or altering characters:
 * braced blocks stay whole, top-level `;` statements stay whole, and comments, strings,
 * escapes, and parenthesized groups (such as data URIs) do not split a rule.
 * @internal
 */
export function splitTopLevelRules(css: string): string[] {
  const rules: string[] = []
  let depth = 0
  let parens = 0
  let start = 0
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      const leadingOnly = depth === 0 && parens === 0 && css.slice(start, i).trim() === ''
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 2
      if (leadingOnly) {
        rules.push(css.slice(start, i))
        start = i
      }
    } else if (ch === '\\') {
      i = Math.min(i + 2, css.length)
    } else if (ch === '"' || ch === "'") {
      const quote = ch
      i += 1
      while (i < css.length && css[i] !== quote) {
        i += css[i] === '\\' ? 2 : 1
      }
      if (i < css.length) {
        i += 1
      }
    } else if (ch === '{') {
      depth += 1
      i += 1
    } else if (ch === '}') {
      if (depth > 0) {
        depth -= 1
      }
      i += 1
      if (depth === 0 && parens === 0) {
        rules.push(css.slice(start, i))
        start = i
      }
    } else if (ch === '(') {
      depth += 1
      parens += 1
      i += 1
    } else if (ch === ')') {
      if (depth > 0) {
        depth -= 1
      }
      if (parens > 0) {
        parens -= 1
      }
      i += 1
    } else if (ch === ';' && depth === 0) {
      rules.push(css.slice(start, i + 1))
      start = i + 1
      i += 1
    } else {
      i += 1
    }
  }
  if (start < css.length) {
    rules.push(css.slice(start))
  }
  return rules
}

/** Partitions top-level `@property` rules for the document and leaves every other rule for the shadow root. */
export function splitStylesheet(css: string): SplitStylesheet {
  const documentParts: string[] = []
  const shadowParts: string[] = []
  for (const rule of splitTopLevelRules(css)) {
    if (PROPERTY_RULE.test(rule.trimStart())) {
      documentParts.push(rule)
    } else {
      shadowParts.push(rule)
    }
  }
  return {
    documentCss: documentParts.join(''),
    shadowCss: shadowParts.join(''),
    propertyCount: documentParts.length,
  }
}

interface SharedStyleEntry {
  style: HTMLStyleElement
  count: number
}

const sharedStyles = new WeakMap<Document, SharedStyleEntry>()

/**
 * Ensures one `<style data-estela-shared>` exists on `doc` while at least one element is connected.
 * Returns a release callback that removes the style element when the last connected element disconnects.
 */
export function acquireSharedStyles(doc: Document, css: string): () => void {
  if (!css) {
    return () => {}
  }
  let entry = sharedStyles.get(doc)
  if (!entry) {
    const style = doc.createElement('style')
    style.setAttribute(SHARED_STYLE_ATTR, '')
    style.textContent = css
    doc.head.append(style)
    entry = { style, count: 0 }
    sharedStyles.set(doc, entry)
  } else if (!entry.style.isConnected) {
    doc.head.append(entry.style)
  }
  entry.count += 1
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const current = sharedStyles.get(doc)
    if (!current || current !== entry) {
      return
    }
    current.count -= 1
    if (current.count <= 0) {
      current.style.remove()
      sharedStyles.delete(doc)
    }
  }
}
