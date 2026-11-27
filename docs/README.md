# Documentation

Placement, writing rules, and plan retirement: [`docs/AGENTS.md`](AGENTS.md).
Contribution workflow and Change Design Gate: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Index

- [`guide/README.md`](guide/README.md) — user guide: install and run Estela, concepts, workspace, supported agents, reports and exports, MCP tools, privacy, and troubleshooting.
- [`reference/public-interface.md`](reference/public-interface.md) — what SemVer covers from 1.0, and the current pre-1.0 policy.
- [`reference/export-formats.md`](reference/export-formats.md) — ATIF and OTLP mappings and their pinned versions.
- [`reference/mcp-tools.md`](reference/mcp-tools.md) — every tool's inputs, result fields, bounds, and errors.
- [`architecture/overview.md`](architecture/overview.md) — system boundaries, data flow, and bundle constraints.
- [`development/setup.md`](development/setup.md) — contributor setup and local workflows.
- [`development/adding-an-agent.md`](development/adding-an-agent.md) — adding support for a new agent.
- [`plans/`](plans/) — active implementation plans; each is retired in its final delivery PR.

## Repository-Specific Surfaces

For the surfaces below, these rules take precedence over the generic defaults in `docs/AGENTS.md`:

- `guide/` (singular) is the user-guide directory consumed by `apps/site` and `scripts/check-doc-translations.mjs`.
- `assets/` holds images referenced by the root `README.md` and these docs; `design/` holds HTML mockups and design notes.
- Bilingual `.zh-CN.md` reading copies are required for the root `README.md` and every document in `docs/guide/`, `docs/reference/`, `docs/architecture/`, and `docs/development/`, updated in the same PR and verified with `node scripts/check-doc-translations.mjs` (see [`CONTRIBUTING.md#bilingual-documentation`](../CONTRIBUTING.md#bilingual-documentation)). `docs/AGENTS.md`, `docs/README.md`, `docs/design/`, and `docs/plans/` are English-only.
