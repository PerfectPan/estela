import { runInNewContext } from 'node:vm'
import { expect, it } from 'vite-plus/test'
import { DOCS_PENDING_CLASS, LANG_STORAGE_KEY } from './lang-preference.ts'
import { languageBootScript } from './language-boot-script.ts'

// Catches mismatches between the inline head script and languageFrom, or URL mutation during boot.
it('embeds the storage key, pending class, and locale literals', () => {
  const script = languageBootScript()
  expect(script).toContain(JSON.stringify(LANG_STORAGE_KEY))
  expect(script).toContain(JSON.stringify(DOCS_PENDING_CLASS))
  expect(script).toContain('stored==="en"||stored==="zh-CN"')
  expect(script).toContain('indexOf("zh")===0')
  expect(script).toContain('document.documentElement.lang=lang')
  expect(script).not.toContain('/zh')
})

it.each(['/estela/', '/estela/docs'])('restores stored zh-CN at %s without rewriting the URL', pathname => {
  const classes = new Set<string>()
  const documentElement = { lang: 'en', classList: { add: (value: string) => classes.add(value) } }
  const location = { pathname }
  runInNewContext(languageBootScript(), {
    document: { documentElement },
    localStorage: { getItem: () => 'zh-CN' },
    navigator: { language: 'en-US' },
    location,
  })
  expect(documentElement.lang).toBe('zh-CN')
  expect(classes.has(DOCS_PENDING_CLASS)).toBe(true)
  expect(location.pathname).toBe(pathname)
})

it('falls back to navigator.language when storage has no valid locale', () => {
  const classes = new Set<string>()
  const documentElement = { lang: 'en', classList: { add: (value: string) => classes.add(value) } }
  runInNewContext(languageBootScript(), {
    document: { documentElement },
    localStorage: { getItem: () => null },
    navigator: { language: 'zh-Hans-CN' },
  })
  expect(documentElement.lang).toBe('zh-CN')
  expect(classes.has(DOCS_PENDING_CLASS)).toBe(true)
})
