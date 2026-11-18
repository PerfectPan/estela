import { defineI18n } from 'fumadocs-core/i18n'
import { uiTranslations } from 'fumadocs-ui/i18n'

export const docsI18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh-CN'],
  parser: 'dot',
  hideLocale: 'default-locale',
  fallbackLanguage: 'en',
})

export const translations = docsI18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: 'English' },
    'zh-CN': { displayName: '中文' },
  })
