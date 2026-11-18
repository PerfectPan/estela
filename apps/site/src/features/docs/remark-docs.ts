import path from 'node:path'

const REPOSITORY_BLOB = 'https://github.com/PerfectPan/estela/blob/main'
const INCLUDED_DOC = /^docs\/(?:guide|reference|architecture)\/[^/]+(?:\.zh-CN)?\.md$/

interface MdastNode {
  type: string
  depth?: number
  url?: string
  alt?: string
  value?: string
  name?: string
  attributes?: { type: string; name: string; value: string }[]
  data?: {
    estelaImgAttrs?: { width?: string; height?: string }
  }
  children?: MdastNode[]
}

function toRepoDocPath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const marker = '/docs/'
  const index = normalized.lastIndexOf(marker)
  if (index !== -1) {
    return normalized.slice(index + 1)
  }
  if (normalized.startsWith('docs/')) {
    return normalized
  }
  return `docs/${normalized.replace(/^\/+/, '')}`
}

function isIncludedDoc(repoPath: string): boolean {
  return repoPath === 'docs/design/README.md' || INCLUDED_DOC.test(repoPath)
}

function docSiteUrl(repoPath: string): string {
  const withoutDocs = repoPath.slice('docs/'.length)
  const withoutExt = withoutDocs.replace(/(?:\.zh-CN)?\.md$/, '')
  const slugPath = withoutExt.endsWith('/README') ? withoutExt.slice(0, -'/README'.length) : withoutExt
  return `/docs/${slugPath}`
}

/**
 * Rewrites a markdown link target from a doc under `docs/` to its site URL when the target is an included doc,
 * or to its `github.com/PerfectPan/estela/blob/main/...` URL otherwise. Absolute URLs and `#anchors` stay.
 */
export function rewriteDocLink(href: string, docFilePath: string): string {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    return href
  }
  const hashIndex = href.indexOf('#')
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex)
  if (rawPath === '') {
    return href
  }
  const currentRepoPath = toRepoDocPath(docFilePath)
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(currentRepoPath), rawPath))
  if (resolved.startsWith('..')) {
    return href
  }
  if (isIncludedDoc(resolved)) {
    return `${docSiteUrl(resolved)}${hash}`
  }
  return `${REPOSITORY_BLOB}/${resolved}${hash}`
}

function readAttr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return match?.[1]
}

function parseImgHtml(value: string): MdastNode | undefined {
  const trimmed = value.trim()
  if (!/^<img\b[^>]*>$/i.test(trimmed)) {
    return undefined
  }
  const src = readAttr(trimmed, 'src')
  if (!src) {
    return undefined
  }
  return {
    type: 'image',
    url: src,
    alt: readAttr(trimmed, 'alt') ?? '',
    data: {
      estelaImgAttrs: {
        width: readAttr(trimmed, 'width'),
        height: readAttr(trimmed, 'height'),
      },
    },
  }
}

function walkNodes(node: MdastNode, visit: (child: MdastNode, index: number, parent: MdastNode) => void): void {
  if (!node.children) {
    return
  }
  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i]!
    visit(child, i, node)
    walkNodes(child, visit)
  }
}

/**
 * Runs before Fumadocs' `remarkHeading` and `remarkImage`: removes the top-level `# ` heading (already rendered
 * by `DocsTitle`), rewrites relative links, and turns raw `<img>` HTML into mdast image nodes so Vite bundles them.
 */
export function remarkDocsPre() {
  return (tree: MdastNode, file: { path?: string }) => {
    if (tree.children) {
      const firstH1 = tree.children.findIndex(child => child.type === 'heading' && child.depth === 1)
      if (firstH1 !== -1) {
        tree.children.splice(firstH1, 1)
      }
    }
    const docFilePath = file.path ?? 'docs/guide/README.md'
    walkNodes(tree, (node, index, parent) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        node.url = rewriteDocLink(node.url, docFilePath)
        return
      }
      if (node.type === 'html' && typeof node.value === 'string' && parent.children) {
        const imgNode = parseImgHtml(node.value)
        if (imgNode) {
          parent.children[index] = imgNode
        }
      }
    })
  }
}

/** Runs after `remarkImage` to restore `width` and `height` attributes on converted `<img>` elements. */
export function remarkDocsPost() {
  return (tree: MdastNode) => {
    walkNodes(tree, node => {
      if (node.type !== 'mdxJsxFlowElement' || node.name !== 'img' || !node.data?.estelaImgAttrs) {
        return
      }
      const { width, height } = node.data.estelaImgAttrs
      node.attributes ??= []
      if (width) {
        node.attributes.push({ type: 'mdxJsxAttribute', name: 'width', value: width })
      }
      if (height) {
        node.attributes.push({ type: 'mdxJsxAttribute', name: 'height', value: height })
      }
    })
  }
}
