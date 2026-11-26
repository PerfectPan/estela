#!/usr/bin/env node
// Checks the Chinese reading copies against their English sources. English is the source of truth.
// See CONTRIBUTING.md#bilingual-documentation. `--write <path>...` records the English text a checked copy matches.
import process from 'node:process'
// The workspace root does not install lint-config; root scripts use packages/schema's copy, as vite.config.ts does.
import { runDocTranslations } from '../packages/schema/node_modules/@perfectpan/lint-config/doc-translations.js'

process.exitCode = runDocTranslations({
  sources: ['README.md', 'docs/guide/*.md', 'docs/reference/*.md', 'docs/architecture/*.md', 'docs/development/*.md'],
  translations: ['README.zh-CN.md', 'docs/**/*.zh-CN.md'],
  translationOf: path => path.replace(/\.md$/, '.zh-CN.md'),
  header: path => `> 中文阅读版。以英文原文 ${path} 为准。`,
  stamp: true,
})
