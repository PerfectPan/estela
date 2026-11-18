# @rivus/estela-site

Static landing page and bilingual documentation site for Estela, built with React, TanStack Start, Fumadocs, and Tailwind CSS v4. Prerendered to static HTML for GitHub Pages (`ESTELA_SITE_BASE`, default `/estela/`).

## Structure

- `src/routes/`: TanStack Router virtual routes (`/`, `/docs`, `/docs/$`), prerendered into `dist/client/`.
- `src/landing/`: Hero scene (`wake-scene.tsx` + `wake-fallback.tsx`), header, feature sections, live demo embed, footer, and metadata (`page-head.ts`).
- `src/features/docs/`: Fumadocs MDX loader and sidebar layout (`source.ts`), remark link/image rewriting (`remark-docs.ts`), static search index export (`write-search-index.ts`, `search-export.ts`), and page metadata (`docs-head.ts`).
- `src/i18n/`: Single-URL `en` / `zh-CN` dictionaries, `localStorage['estela-lang']` boot script, and Chinese UI strings for Fumadocs (`docs-ui-zh.ts`).
- `scripts/publish-search-index.mjs`: copies generated `dist/.search/search.{en,zh-CN}.json` into `dist/client/api/`.
- `scripts/build-demo.mjs`: runs the built `@rivus/estela` CLI to write the live session report into `dist/client/demo/`.
- `scripts/check-site.mjs`: serves `dist/client` strictly under `ESTELA_SITE_BASE` (no SPA fallback) and drives headless Chrome over CDP to verify navigation, `<title>` and canonical tags, single-URL language switching, reload persistence, static search assets, images, fallback notice, and `/demo/`.

## Design Rules

- **Single URL across languages**: English and Chinese share the same URLs (`/`, `/docs/...`); there are no `/zh/` routes. Language preference lives in `localStorage['estela-lang']`. Docs pages fall back in-place to the English article with a Chinese callout when no `.zh-CN.md` copy exists.
- **Included documentation**: `source.ts` defines the literal `docs.docs.files` globs (`guide/*.md`, `reference/*.md`, `architecture/*.md`, `design/README.md`). `remark-docs.ts` rewrites links to included docs into `/docs/...` URLs and all other repository-relative links to GitHub blob URLs (`main`).
- **Base path safe**: all built routes and static assets honor `ESTELA_SITE_BASE` (`import.meta.env.BASE_URL`).

## Commands

Run from the workspace root or inside `apps/site`:

```sh
pnpm --filter @rivus/estela-site run dev
pnpm --filter '@rivus/estela-site...' run build
pnpm --filter @rivus/estela-site run check
pnpm --filter @rivus/estela-site test
pnpm --filter @rivus/estela-site lint
pnpm --filter @rivus/estela-site typecheck
```

`build` requires `@rivus/estela` to be built (`'@rivus/estela-site...'` handles that from a clean tree). `check` runs headless Chrome against `dist/client` (`CHROME` overrides the browser executable path).

## GitHub Pages

[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) is manually dispatched (`workflow_dispatch`) until GitHub Pages is enabled in repository settings (**Settings -> Pages -> Source: GitHub Actions**). Once enabled, add a `push` trigger on `main` filtering `apps/site/**` and `docs/**`.
