import { createFileRoute, useParams } from '@tanstack/react-router'
import { docsHead } from '@/features/docs/docs-head.ts'
import { docsPageMeta } from '@/features/docs/docs-meta.ts'
import { DocsScreen } from '@/features/docs/docs-page.tsx'
import { docsUrl, slugsFromSplat } from '@/features/docs/docs-path.ts'

function DocsPage() {
  const { _splat } = useParams({ from: '/docs/$' })
  return <DocsScreen splat={_splat} />
}

export const Route = createFileRoute('/docs/$')({
  component: DocsPage,
  loader: ({ params }) => {
    const slugs = slugsFromSplat(params._splat)
    return docsPageMeta(slugs, docsUrl(slugs))
  },
  head: ({ loaderData }) => docsHead(loaderData),
})
