import { createFileRoute, redirect } from '@tanstack/react-router'
import { docsHead } from '@/features/docs/docs-head.ts'
import { docsPageMeta } from '@/features/docs/docs-meta.ts'
import { DocsScreen } from '@/features/docs/docs-page.tsx'

function DocsIndex() {
  return <DocsScreen splat="guide" />
}

export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
  // Client visits forward to `/docs/guide/` so the sidebar highlights User Guide; SSR still prerenders static HTML + refresh.
  beforeLoad: () => {
    if (!import.meta.env.SSR) {
      throw redirect({ to: '/docs/$/', params: { _splat: 'guide' }, replace: true })
    }
  },
  loader: () => docsPageMeta(['guide'], '/docs/guide/'),
  head: ({ loaderData }) => {
    const baseHead = docsHead(loaderData)
    return {
      ...baseHead,
      meta: [...baseHead.meta, { httpEquiv: 'refresh', content: `0;url=${import.meta.env.BASE_URL}docs/guide/` }],
    }
  },
})
