#!/usr/bin/env node
// Checks that every active Spec and Plan has a Chinese reading copy that matches its structure.
// English is the source of truth. See CONTRIBUTING.md#bilingual-specs-and-plans.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const dirs = ['docs/specs', 'docs/plans']
const skip = new Set(['README.md', '0000-template.md'])
const ZH = '.zh-CN.md'

function banner(englishPath) {
  return `> 中文阅读版。以英文原文 ${englishPath} 为准。`
}

/** Heading counts per level and fenced code blocks, ignoring headings inside fences. */
function shape(text) {
  const headings = [0, 0, 0, 0, 0, 0]
  const fences = []
  let fence = null
  for (const line of text.split('\n')) {
    const open = line.match(/^(`{3,}|~{3,})(.*)$/)
    if (fence) {
      if (open && open[1][0] === fence.marker[0] && open[1].length >= fence.marker.length && open[2].trim() === '') {
        fences.push(fence.body.join('\n'))
        fence = null
      } else {
        fence.body.push(line)
      }
      continue
    }
    if (open) {
      fence = { marker: open[1], body: [`info:${open[2].trim()}`] }
      continue
    }
    const h = line.match(/^(#{1,6})\s/)
    if (h) {
      headings[h[1].length - 1]++
    }
  }
  return { headings, fences }
}

const problems = []
let pairs = 0

for (const dir of dirs) {
  const abs = join(root, dir)
  if (!existsSync(abs)) {
    continue
  }
  const names = readdirSync(abs).filter(n => n.endsWith('.md'))
  for (const name of names) {
    if (name.endsWith(ZH)) {
      const english = name.slice(0, -ZH.length) + '.md'
      if (!names.includes(english)) {
        problems.push(`${dir}/${name}: no English source ${dir}/${english}`)
      }
      continue
    }
    if (skip.has(name)) {
      continue
    }
    const en = `${dir}/${name}`
    const zh = `${dir}/${name.slice(0, -3)}${ZH}`
    if (!existsSync(join(root, zh))) {
      problems.push(`${en}: missing Chinese reading copy ${zh}`)
      continue
    }
    pairs++
    const enText = readFileSync(join(root, en), 'utf8')
    const zhText = readFileSync(join(root, zh), 'utf8')
    const first = zhText.split('\n').find(l => l.trim() !== '')
    if (first !== banner(en)) {
      problems.push(`${zh}: first line must be: ${banner(en)}`)
    }
    const a = shape(enText)
    const b = shape(zhText)
    a.headings.forEach((count, i) => {
      if (count !== b.headings[i]) {
        problems.push(`${zh}: ${b.headings[i]} level-${i + 1} headings, English has ${count}`)
      }
    })
    if (a.fences.length !== b.fences.length) {
      problems.push(`${zh}: ${b.fences.length} code blocks, English has ${a.fences.length}`)
    } else {
      a.fences.forEach((body, i) => {
        if (body !== b.fences[i]) {
          problems.push(`${zh}: code block ${i + 1} differs from English; code and diagrams are copied unchanged`)
        }
      })
    }
  }
}

if (problems.length) {
  console.error('check-doc-translations: failed')
  for (const p of problems) {
    console.error(`  - ${p}`)
  }
  process.exit(1)
}
console.log(`check-doc-translations: ok (${pairs} pair${pairs === 1 ? '' : 's'})`)
