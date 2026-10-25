import { describe, expect, it } from 'vite-plus/test'
import { en } from './dictionary.en.ts'
import { zhCN } from './dictionary.zh-CN.ts'

/** The shape both dictionaries have: nested records of template strings. */
type Nested = { [key: string]: string | Nested }

function flat(value: Nested, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof item === 'string') {
      out.set(path, item)
    } else {
      flat(item, path).forEach((text, nested) => out.set(nested, text))
    }
  }
  return out
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(match => match[1]!).toSorted()
}

describe('dictionaries', () => {
  it('use the same placeholders for every key in en and zh-CN', () => {
    const english = flat(en)
    const chinese = flat(zhCN)
    expect([...chinese.keys()].toSorted()).toEqual([...english.keys()].toSorted())
    for (const [key, text] of english) {
      expect({ key, names: placeholders(chinese.get(key)!) }).toEqual({ key, names: placeholders(text) })
    }
  })
})
