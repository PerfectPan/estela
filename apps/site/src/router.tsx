import { createRouter } from '@tanstack/react-router'
import { normalizeBasePath } from './lib/site.ts'
import { routeTree } from './route-tree.gen.ts'

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: normalizeBasePath(import.meta.env.BASE_URL),
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
