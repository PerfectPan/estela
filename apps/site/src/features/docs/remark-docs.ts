import path from 'node:path'
import type { Image, Parents, Root } from 'mdast'
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx'
import { visit } from 'unist-util-visit'

const REPOSITORY_BLOB = 'https://github.com/PerfectPan/estela/blob/main'
// Keep paired with the literal `docs.docs.files` globs in `source.ts`.
const INCLUDED_DOC = /^docs\/(?:guide|reference|architecture)\/[^/]+(?:\.zh-CN)?\.md$/

interface EstelaImgAttrs {
  width?: string
  height?: string
}

declare module 'mdast' {
  interface Data {
    estelaImgAttrs?: EstelaImgAttrs
  }
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

// Paired with `docs.docs.files` in `source.ts`.
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

function parseImgHtml(value: string): Image | undefined {
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

function replaceHtmlWithImage(parent: Parents, index: number, imgNode: Image): void {
  // Narrowing of a known mdast Parents union so image vs block-paragraph placement stays type-safe without casts.
  if (
    parent.type === 'root'
    || parent.type === 'paragraph'
    || parent.type === 'heading'
    || parent.type === 'tableCell'
    || parent.type === 'emphasis'
    || parent.type === 'strong'
    || parent.type === 'delete'
    || parent.type === 'link'
    || parent.type === 'linkReference'
    || parent.type === 'mdxJsxTextElement'
  ) {
    parent.children[index] = imgNode
    return
  }
  if (
    parent.type === 'blockquote'
    || parent.type === 'listItem'
    || parent.type === 'footnoteDefinition'
    || parent.type === 'mdxJsxFlowElement'
  ) {
    parent.children[index] = { type: 'paragraph', children: [imgNode] }
  }
}

function setStringAttr(attributes: MdxJsxFlowElement['attributes'], name: string, value: string): void {
  if (!attributes.some(attr => attr.type === 'mdxJsxAttribute' && attr.name === name)) {
    attributes.push({ type: 'mdxJsxAttribute', name, value })
  }
}

/**
 * Runs before Fumadocs' `remarkHeading` and `remarkImage`: removes the top-level `# ` heading (already rendered
 * by `DocsTitle`), rewrites relative links, and turns raw `<img>` HTML into mdast image nodes so Vite bundles them.
 */
export function remarkDocsPre() {
  return (tree: Root, file: { path?: string }) => {
    if (!file.path) {
      throw new Error('remarkDocsPre expected a file path to resolve relative links')
    }
    const docFilePath = file.path
    const firstH1 = tree.children.findIndex(child => child.type === 'heading' && child.depth === 1)
    if (firstH1 !== -1) {
      tree.children.splice(firstH1, 1)
    }
    visit(tree, (node, index, parent) => {
      if (node.type === 'link') {
        node.url = rewriteDocLink(node.url, docFilePath)
        return
      }
      if (node.type === 'html' && index !== undefined && parent) {
        const imgNode = parseImgHtml(node.value)
        if (imgNode) {
          replaceHtmlWithImage(parent, index, imgNode)
        }
      }
    })
  }
}

/** Runs after `remarkImage` to restore `width` and `height` attributes on converted `<img>` elements. */
export function remarkDocsPost() {
  return (tree: Root) => {
    visit(tree, 'mdxJsxFlowElement', node => {
      if (node.name !== 'img' || !node.data?.estelaImgAttrs) {
        return
      }
      const { width, height } = node.data.estelaImgAttrs
      if (width) {
        setStringAttr(node.attributes, 'width', width)
      }
      if (height) {
        setStringAttr(node.attributes, 'height', height)
      }
    })
  }
}
