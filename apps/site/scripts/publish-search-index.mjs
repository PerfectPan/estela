#!/usr/bin/env node
// Copies the per-language search databases written during prerender into the static client output.
// Docs search is added in phase 2; skip when no search directory was written yet.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceDir = join(siteRoot, 'dist/.search')
const targetDir = join(siteRoot, 'dist/client/api')

if (existsSync(sourceDir)) {
  mkdirSync(targetDir, { recursive: true })
  for (const lang of ['en', 'zh-CN']) {
    const source = join(sourceDir, `search.${lang}.json`)
    if (!existsSync(source)) {
      throw new Error(`missing search index at ${source}`)
    }
    const target = join(targetDir, `search.${lang}.json`)
    copyFileSync(source, target)
    console.log(`search index ${target}`)
  }
}
