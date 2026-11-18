import { createFileRoute } from '@tanstack/react-router'
import { docsHead } from '@/features/docs/docs-head.ts'
import { DocsScreen, docsPageMeta } from '@/features/docs/docs-page.tsx'

function DocsIndex() {
  return <DocsScreen splat="guide" />
}

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
  // `/docs` renders the guide landing page, so its canonical points at `/docs/guide`.
  loader: () => docsPageMeta(['guide'], '/docs/guide'),
  head: ({ loaderData }) => docsHead(loaderData),
})
