Title format: `type(scope): summary`, in English.

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Summary

<!-- What changed and why. Link the issue, Spec, or Plan when there is one. -->

-

## Validation

<!-- Commands you ran and their results; logs or screenshots for behavior claims. Name skipped checks and why. -->

- [ ] Repository checks: `gh repo-checks repository`
- [ ] Docs, file conventions, layers: `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-layers.mjs`
- [ ] MR title and description: `gh repo-checks pr-title "<title>"`, `gh repo-checks pr-body <body-file>`
- [ ] Changeset for shipped changes: a file under `.changeset/` (documentation-only and workflow-only MRs need none)
- [ ] Lint, test, typecheck, build: `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`
- [ ] Browser bundle: `node scripts/check-browser-bundle.mjs`

## Risks

<!-- Optional: compatibility, rollout, rollback, or follow-up risks. Delete this section when there are none. -->

-
