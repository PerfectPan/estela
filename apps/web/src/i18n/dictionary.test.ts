import { describe, expect, it } from 'vitest'
import { en } from './dictionary.en.ts'
import { zhCN } from './dictionary.zh-CN.ts'

function flat(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof item === 'string')
      out.set(path, item)
    else
      flat(item, path).forEach((text, nested) => out.set(nested, text))
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
    for (const [key, text] of english)
      expect({ key, names: placeholders(chinese.get(key)!) }).toEqual({ key, names: placeholders(text) })
  })
})
