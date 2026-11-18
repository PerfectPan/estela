# @rivus/estela-site

Static landing page and bilingual documentation site for Estela: React + TanStack Start + Fumadocs + Tailwind CSS v4, prerendered to static files for GitHub Pages. Private; not part of the npm package.

```sh
pnpm --filter '@rivus/estela-site...' run build   # builds the CLI first, then the site into dist/client
pnpm --filter @rivus/estela-site run check         # headless Chrome navigation & assertion suite
pnpm --filter @rivus/estela-site run dev
```

## What a change must keep

- **Static output.** `dist/client` is the whole site: `/` (landing), `/docs/...` (Fumadocs documentation), `/api/search.{en,zh-CN}.json` (static search indexes), and `/demo/`. Everything except the WebGL canvas, copy button, and interactive search reads without script.
- **Single URL across languages.** English and Chinese share the same URLs (`/`, `/docs/...`), with no `/zh/` routes. Language preference lives in `localStorage['estela-lang']`; an untranslated docs page falls back in place to English with a Chinese callout.
- **Included documentation.** `src/features/docs/source.ts` defines the literal `docs.docs.files` globs (`guide/*.md`, `reference/*.md`, `architecture/*.md`, `design/README.md`). `src/features/docs/remark-docs.ts` rewrites links to included docs into `/docs/.../` URLs, points other repo-relative links at GitHub (`main`), and fails the build on raw HTML other than `<img>` and comments.
- **Base path and trailing slashes.** `ESTELA_SITE_BASE` sets the base (default `/estela/`). The Pages workflow (`.github/workflows/pages.yml`) sets it to `/<repository name>/`. Canonical URLs (`SITE_ORIGIN` in `src/content/links.ts` plus base) and internal docs links keep a trailing slash (`trailingSlash: 'always'`).
- **The demo is the real report.** `scripts/build-demo.mjs` runs the built CLI's `build` on the bundled demo fixture into `dist/client/demo/`. It passes the fixture path explicitly: with no path, `build` would read `ESTELA_PATH` first and could put a developer's own session into the public site.
- **Claims come from the README.** The dictionaries (`src/i18n/`, `dictionary.en.ts` is the type source) restate the root README and `docs/guide/`; change them together. Commands, flags, paths, and format names stay in English in every locale.
- **The hero scene.** The sample session (`src/scene/session-shape.ts`) is seeded, so the server render, the SVG fallback (`src/scene/wake-fallback.tsx`), and the WebGL scene (`src/scene/wake-scene.tsx`, `src/scene/wake-renderer.ts`) are identical. The SVG fallback is always prerendered and stays when motion is reduced, when there is no WebGL context, or when the context is lost; in those cases the renderer chunk (`ogl`, loaded by dynamic import after hydration) is never fetched.
- **Routes are virtual.** They are declared in `vite.config.ts` because the file-route convention names are not kebab-case. `src/route-tree.gen.ts` is generated and committed so `tsc` runs before a build.
- **No workspace imports.** Design tokens and stroke icons are self-contained inside `apps/site` instead of imported from `apps/web`. `@rivus/estela` is a devDependency only so that `pnpm --filter '@rivus/estela-site...' run build` builds the CLI first; `scripts/check-layers.mjs` allows only that edge.
- **No third parties.** No cookies and no third-party resources; fonts are bundled. `estela-lang` and `estela-theme` are the only `localStorage` keys.

## The OG image

`public/og-image.png` is a 1200 × 630 capture of the static hero (no WebGL). Capture it again after a change to the hero.

## GitHub Pages

Before the first deploy runs, configure the repository once at **Settings -> Pages -> Source: GitHub Actions**. [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) deploys from `main` on pushes matching `apps/site/**` or `docs/**` and on manual `workflow_dispatch`; pull requests are checked by the CI workflow's `Build and verify the docs site` step.
