# Adding an agent

Audience: contributors adding session-reading support for a new coding agent, or extending an existing reader with new capabilities.

Session reading lives in [`@rivus/agent-kit`](https://github.com/PerfectPan/agent-kit); Estela bundles the kit and wires the reader's fixtures, display metadata, UI colors, and docs. Adding a new agent therefore spans two repositories in order: first the reader and its conformance suite in `agent-kit`, then the pickup in `estela`.

## 1. Implement the reader in `@rivus/agent-kit`

All session adapters live in [`PerfectPan/agent-kit`](https://github.com/PerfectPan/agent-kit) as private provider packages under `packages/providers/<agent>/` (see `docs/architecture/authoring.md` in that repository for its boundary and lint rules).

1. **Create or extend the provider package** under `packages/providers/<agent>/`:
   - `src/facts.ts`: canonical agent id, display name, default home rule, and environment override variable.
   - `src/layout.ts` and `src/records.ts` (or `src/records/`): storage layout and `zod/mini` record schemas shared by session reading and usage decoding.
   - `src/identity.ts`: `CodingAgent` identity entry.
   - `src/sessions.ts` (with helpers under `src/sessions/`): the `SessionAdapter` (`specificationVersion: "sessions-v1"`).
2. **Implement the `SessionAdapter` SPI** (`packages/sessions/src/application/spi.ts` in `agent-kit`):
   - Metadata fields: `specificationVersion: "sessions-v1"`, `agent`, `displayName`, `capabilities`, and optional `home` (`HomeRule`).
   - `roots`: return the directories under the agent's home that hold its sessions.
   - `discover`: list session references under each root without loading full transcripts.
   - `detect`: recognize the agent's session files when opened directly by path.
   - `load`: translate records into ordered `TranscriptEvent` values, recording `agentVersion` when the log stores one, `capabilities` for what the reader actually extracts, and accurate `SourcePointer` offsets (byte ranges, decompressed line offsets, or SQLite row pointers) so `readOriginal` can fetch any event's raw record back.
   - `summarize` (optional): stream summary counts and prompts without materializing the full transcript.
   - **Fail loud on unknown format generations**: return `UnknownFormatGeneration` (never silently drop or guess) when a file header, schema version, or record envelope belongs to an unsupported generation.
3. **Wire the provider into the kit shell**:
   - Register the provider in `packages/agent-kit/src/providers/` (add its identity entry in `identity.ts` and its session adapter in `sessions.ts`; `builtin.ts` derives `builtinProviders` from those service tables).
   - Update the support matrix in `packages/agent-kit/README.md` (checked by `packages/agent-kit/test/provider-tables.test.ts`).
4. **Add conformance fixtures and tests** in `packages/providers/<agent>/test/`:
   - Write synthetic fixtures covering every declared capability (requests, usage, reasoning, compaction, subagents, hooks, system prompt, tool schemas) plus an unknown-type record and an unknown-generation failure case.
   - Run `sessionAdapterConformance(adapter, fixtures)` from `@rivus/agent-kit/testing` and verify all kit tests, typechecks, and boundary checks pass.
5. **Publish `@rivus/agent-kit`** following its release runbook (`docs/development/release.md` in `agent-kit`).

## 2. Pick up the agent in Estela

Once the new `@rivus/agent-kit` version is published to npm, adopt it in Estela (see PRs `#162` and `#165` for reference examples):

### Bump the kit dependency

1. Update `'@rivus/agent-kit'` in `pnpm-workspace.yaml` and run `pnpm install` to refresh `pnpm-lock.yaml`. Because `@rivus/agent-kit` is in `minimumReleaseAgeExclude`, it installs right after npm publication.
2. If the kit release changed any `TranscriptEvent` payload shape or added a field Estela reads, update `packages/schema/src/types.ts` and `packages/schema/src/payloads.test.ts` in the same PR.

### Wire server adapter metadata

`packages/server/src/sessions/adapters.ts` automatically loads every built-in kit provider that exports `.sessions` into `builtinAdapters`. Check two maps in that file:

- `PRODUCT_NAMES`: add an entry if the kit adapter's `displayName` is its raw id rather than its product name (for example `opencode: 'OpenCode'`).
- `DATABASE_AGENTS` (`keepsSessionsInDatabase`): add the agent id if it stores all sessions as rows of one SQLite database and its `lastActiveAt` moves with every write to that session — the catalog puts the session id in the trace id and keys each row by its own `lastActiveAt` rather than the shared database stamp, so a write to one session leaves the others' cached summaries alone. `packages/server/src/sessions/conformance.test.ts` verifies that `keepsSessionsInDatabase(agent)` matches whether the adapter's events carry `source.sqlite`.

### Copy conformance fixtures and register the suite

1. Copy the kit reader's conformance fixtures into `fixtures/sessions/<agent>/conformance/` (keeping the agent's native filenames). If the reader rejects an unknown format generation, add a fixture under `fixtures/sessions/<agent>/unknown-generation/` as well.
2. Register the agent in `packages/server/src/sessions/conformance.test.ts`:
   - Add a `ConformanceSession[]` list naming each fixture path, `records` count, `capabilities`, optional `files` (for sidecar subagent logs), and `sessionId` / `recordKeys` (for SQLite databases or compressed logs).
   - Add `[agent, sessions]` to `SUITES`. The test `covers every built-in adapter` fails until every built-in adapter appears in `SUITES`.
   - Add an entry to `DISCOVERY_ROOTS` if discovery starts below the conformance folder, and add a line to `OVERSIZED_LINES` when testing oversized-file rejection.
   - Add the unknown-generation fixture to `unknown generations fail loud on the repo fixtures` when present.

### Add web UI and site metadata

| Surface | Files | What to add |
|---|---|---|
| Web display name | `apps/web/src/lib/agent-names.ts` | `AGENT_NAMES[<id>]`: English product name (never translated). |
| Web agent chip | `apps/web/src/browser/agent-mark.tsx` | `LETTER[<id>]`: 1–2 letter mark. |
| Web theme colors | `apps/web/src/styles.css` | `--agent-<id>` in both the dark (`:root, html[data-theme="dark"]`) and light (`html[data-theme="light"]`) token blocks. |
| Site agent list | `apps/site/src/content/agents.ts` | Entry with `id`, `name`, `paths`, and `home` override variable. |
| Site agent grid | `apps/site/src/landing/agents-grid.tsx` | Revisit the footnote `<li>` column spans (`sm:col-span-2 lg:col-span-4`), which assume twelve agents fill whole rows at every breakpoint. |
| Site theme colors | `apps/site/src/styles.css` | `--agent-<id>` in both the light (`:root`) and dark (`.dark`) token blocks. |
| Site agent count copy | `apps/site/src/i18n/dictionary.en.ts`, `apps/site/src/i18n/dictionary.zh-CN.ts` | Update the supported-agent count if the landing copy names it. |

### Update documentation and changeset

Every document under `docs/guide/`, `docs/reference/`, `docs/architecture/`, `docs/development/`, and the root `README.md` has a `.zh-CN.md` reading copy updated in the same PR:

1. `docs/guide/supported-agents.md` (+ `.zh-CN.md`): update the kit version and agent count, add the agent to **Where sessions are found**, add its **Tested against** entry (the agent version the kit's source or README says the reader was verified or captured on, plus any log-format version the conformance fixtures record, or `not recorded`) and capability row to **What each agent records**, and note any **Known limits**.
2. `docs/guide/troubleshooting.md` (+ `.zh-CN.md`): add the agent's home override variable to the list under **An agent shows 0 sessions**.
3. `README.md` (+ `.zh-CN.md`), `docs/guide/getting-started.md` (+ `.zh-CN.md`), `docs/guide/concepts.md` (+ `.zh-CN.md`, for the database-agent list), `docs/architecture/overview.md` (+ `.zh-CN.md`), `docs/reference/public-interface.md` / `docs/reference/mcp-tools.md` (+ `.zh-CN.md`), and `AGENTS.md` (the session-index rule if adding a database agent) wherever the agent list, count, database agents, or home overrides appear.
4. Record the updated English blob hashes with `node scripts/check-doc-translations.mjs --write <zh-CN files...>`.
5. Add a changeset under `.changeset/` for `@rivus/estela` (`minor` for a new agent, `patch` for updating an existing reader; see [`CONTRIBUTING.md`](../../CONTRIBUTING.md#kit-upgrades-and-format-change-releases)).

### Verify

Run the full check suite from [Development](setup.md#checks):

```bash
node scripts/format.mjs --check
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
node scripts/check-release-intent.mjs
node scripts/lint-scripts.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @rivus/estela-schema run duplicates
pnpm --filter @rivus/estela-schema run knip
pnpm --filter @rivus/estela-schema run knip:production
pnpm build
node scripts/check-budgets.mjs
```
