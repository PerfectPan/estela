import { describe, expect, it } from 'vite-plus/test'
import { extractDocTitle } from './doc-title.ts'

// Catches regressions in frontmatter-free title extraction across English, Chinese, and fenced code blocks.
describe('extractDocTitle', () => {
  it('extracts the first H1 from English and Chinese docs', () => {
    expect(extractDocTitle('# User guide\n\nBody', 'guide/README.md')).toBe('User guide')
    expect(
      extractDocTitle(
        '> 中文阅读版。以英文原文 docs/guide/README.md 为准。\n\n<!-- source-blob: abc -->\n\n# 用户指南\n',
        'guide/README.zh-CN.md',
      ),
    ).toBe('用户指南')
  })

  it('ignores `#` lines inside fenced code blocks before the heading', () => {
    const source = '```sh\n# not a heading\n```\n\n# Real title\n'
    expect(extractDocTitle(source, 'guide/example.md')).toBe('Real title')
  })

  it('falls back to the filename stem if no H1 exists', () => {
    expect(extractDocTitle('## Only H2\n', 'guide/no-h1.zh-CN.md')).toBe('no-h1')
  })
})
