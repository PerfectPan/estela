# Documentation Standards

Use `docs/` for durable project knowledge that a maintainer or user cannot easily infer from reading the code alone. This includes current architecture and tradeoffs, user guides, factual references, development workflows, and validation boundaries.

Keep collaboration policy in `CONTRIBUTING.md`, AI-agent instructions in `AGENTS.md`, issue and review evidence requirements in templates, and automated enforcement in scripts or CI workflows.

## Start Here

- [User guide](guide/README.md): install and run Estela, the concepts, the workspace, supported agents, reports and exports, MCP tools, privacy, and troubleshooting.
- [Public interface](reference/public-interface.md): what semver covers from 1.0, and the current pre-1.0 policy.
- [Export formats](reference/export-formats.md): the ATIF and OTLP mappings and their pinned versions.
- [MCP tools reference](reference/mcp-tools.md): every tool's inputs, result fields, bounds, and errors.
- [Architecture](architecture/overview.md), [Development](development/setup.md), and [Adding an agent](development/adding-an-agent.md): for contributors.

## What Belongs Here

- `guide/` for user-facing getting-started tutorials and task-oriented how-to guides for the CLI, the workspace, and the MCP tools, one topic per file.
- `reference/` for stable factual contracts and lookup material such as APIs, CLI commands, configuration, protocols, schemas, error codes, compatibility matrices, and SemVer boundaries.
- `architecture/` for maintainer-facing knowledge that code alone cannot express: domain and module boundaries, end-to-end data flow, ownership and trust boundaries, invariants, failure and recovery semantics, and major tradeoffs.
- `development/` for local setup, common development tasks, test strategy, honest validation boundaries, fixtures, debugging workflows, release runbooks, and operational procedures when the project has them.
- `assets/` for images referenced by the root README and by these docs.

Do not create empty directories just to match this list. Add a section when the project has real documentation for that reader need.

## Active Plans Boundary

- [`plans/`](plans/) contains active implementation plans only while non-trivial work is in flight.

The Change Design Gate in [`CONTRIBUTING.md`](../CONTRIBUTING.md#change-design-gate) decides when a change needs a plan. After the code lands on the default branch, move lasting non-code knowledge into `docs/` (and local `Why:` comments in code), move remaining follow-up items to issues, and delete the completed plan. Git history and the delivery PR keep the full plan.

## Writing Standards

- Give every durable document one clear audience, purpose, and owner area.
- Record what source code cannot express: *why* a design or workaround was chosen, alternatives rejected, ownership and trust boundaries, external system quirks, and known validation limits.
- Do not duplicate directory trees, symbol lists, or type signatures that source code and type checks already express.
- Prefer current-state language over historical narration in `docs/`; link to the delivery PR for decision history.
- Keep examples runnable when practical; otherwise label them as illustrative and explain the validation gap.
- Link to source files, commands, schemas, or dashboards when they are the real source of truth.
- Update docs in the same change as behavior, configuration, command, API, deployment, architecture, or operational changes.
- Keep private tokens, internal hostnames, personal filesystem paths, generated logs, and environment-specific secrets out of documentation.
