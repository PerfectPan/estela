/**
 * Extracts the document title from the first Markdown `# ` heading outside fenced code blocks.
 * Falls back to the file stem when a document has no level-1 heading.
 */
export function extractDocTitle(source: string, filePath: string): string {
  let inFence = false
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(line)
    if (match?.[1]) {
      return match[1]
    }
  }
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/(?:\.zh-CN)?\.mdx?$/, '')
}
