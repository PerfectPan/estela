# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
pnpm install
```

Use Node.js `^26.13.1` (26.13.1 or later within 26.x): the root `package.json` checks this development runtime range. The built CLI runs on Node.js 24 or later and exits before loading when Node is older.

## Checks

```bash
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
node scripts/format.mjs --check
pnpm lint
pnpm test
pnpm typecheck
pnpm --filter @rivus/estela-schema run duplicates
pnpm --filter @rivus/estela-schema run knip
pnpm build
node scripts/check-budgets.mjs
```

### Performance and size budgets

`node scripts/check-budgets.mjs` runs after `pnpm build` and uses `apps/cli/dist`. It generates its data into a temp directory and deletes it (`ESTELA_BUDGETS_KEEP=1` keeps it); nothing generated is committed. It measures:

- First rows: a synthetic home with 2,500 Claude Code and 2,500 Codex sessions (about 190 MB, `scripts/budgets/synthetic-home.mjs`). The clock runs from spawning `dist/bin.mjs` to the first `list-sessions({})` response that holds every session, called through DevFrame's own client as the session browser does. The server listens only after the catalog has rows, so this is the moment the browser can show them. Cold has no index; warm reuses the index the cold run wrote after every summary finished, and fails unless the CLI reports that its rows came from the index.
- Large session: a 100 MB Codex rollout from `packages/server/src/testsupport/large-session.ts` (the S12 generator), given on the command line; the clock runs to the `get-trace-view` response, and peak RSS is the CLI process's `maxRSS`.
- Sizes: the web bundle's JS and CSS raw and gzip, `dist/cli.mjs`, and the `pnpm pack` tarball.

It prints a measured-vs-budget table, appends it to `$GITHUB_STEP_SUMMARY` when set, and exits 1 when an enforced budget is exceeded. The budgets, which ones are enforced, and the reason for each number live in `scripts/budgets/budgets.mjs`. A PR that grows a size past its budget raises the number there in the same PR, with the new measurement in the reason and in its Validation section. CI runs it in the `test` job after the tarball smoke step, on that step's build.

## Run the UI

```bash
cd apps/cli
pnpm run dev
```

The CLI opens the browser with the one-time code, or open the `#devframe_otp=` link printed in the terminal.

With no path the app opens the session browser over every registered agent. A positional path (or `ESTELA_PATH`) is loaded before the server listens and opens `#/s/<traceId>`. `--pick` lists the sessions in the terminal. `build` still defaults to `fixtures/demo.trace.json`; `mcp` without a path serves every session.

`fixtures/demo.trace.json` is generated: an invented Claude Code session on a small book catalog API (five turns, 34 main requests with cache token counts, a `/compact`, two subagent lanes, three failed tool calls, hooks, and prompt snapshots), written by `packages/server/src/testsupport/demo-session.ts` and read through the kit into canonical JSON. `demo-trace.test.ts` fails when the committed file and the generator disagree, for example after a kit upgrade; regenerate it with:

```bash
node packages/server/src/testsupport/demo-trace.ts fixtures/demo.trace.json
```

For demos and screenshots, `apps/e2e/src/demo/demo-home.ts <dir>` builds a home with that session plus eight small ones from Claude Code, Codex, Gemini CLI, and Grok on three invented projects. `apps/e2e/src/demo/record-demo.ts` builds that home, starts `apps/cli/dist/bin.mjs` on it (run `pnpm build` first), and writes the README and showcase screenshots and the walkthrough video (MP4, WebM, and a short looping WebP and GIF) to `--out` (default `/tmp/estela-media`). It needs ffmpeg, `cwebp`, and `img2webp` on `PATH`; `--help` lists the outputs.

`build <path> --out-dir <dir>` writes the report as one `<dir>/index.html`; open it straight from disk. "Export report" in the workspace writes the same into a new `estela-report-<traceId>-<time>/` directory under the server's working directory and shows the path.

The session index lives at `$XDG_CACHE_HOME/rivus-estela/index.sqlite`, or `~/.cache/rivus-estela/index.sqlite` when `XDG_CACHE_HOME` is unset. It is a cache: delete it at any time. `--no-index` runs without reading or writing it (search then covers titles and first prompts only). Point `HOME` at a directory with fixture sessions to run against synthetic data:

```bash
HOME=/tmp/estela-home node apps/cli/bin.mjs --no-auth --no-open
```

## Bundle and tarball

`pnpm --filter '@rivus/estela...' run build` builds `apps/cli` with `vp pack` (the `pack` blocks of `apps/cli/vite.config.ts`):

- `dist/bin.mjs` is the package `bin`, built from `apps/cli/bin.mjs`. It checks the Node.js version and drops the `node:sqlite` ExperimentalWarning, then imports `dist/cli.mjs` (from source, the same file imports `src/main.ts`).
- `dist/cli.mjs` bundles the shell, every `@rivus/*` workspace package, `@clack/prompts`, and `@bomb.sh/router`. `devframe` and `@devframes/agentic` stay external as the package's only runtime dependencies. `@devframes/agentic` declares an exact `devframe` peer dependency, so the two stay pinned to the same version.
- `dist/web/` is a copy of `apps/web/dist`, and `dist/fixtures/demo.trace.json` is the default session for `build` and the exports. `src/paths.ts` picks these locations when the pack config defines `ESTELA_BUNDLE`; run from source (`node bin.mjs`), it uses `apps/web/dist` and `fixtures/` in the workspace.
- `dist/THIRD-PARTY-NOTICES.txt` holds the license texts of the npm packages bundled into `cli.mjs` and of those the web build is made from, Vite and Rolldown included through vite-plus-core; the CLI section lists Rolldown too, for the runtime helpers in `cli.mjs` and `bin.mjs` (`apps/cli/scripts/third-party-notices.ts`, a Rolldown plugin).

```bash
pnpm --filter '@rivus/estela...' run build
cd apps/cli
node dist/bin.mjs --help          # the bundle, from the workspace
pnpm pack --pack-destination /tmp  # the tarball; `files` ships dist (with THIRD-PARTY-NOTICES.txt), README.md, LICENSE, CHANGELOG.md once versioned
```

`pnpm pack` rewrites the `workspace:` and `catalog:` specifiers in the manifest into real versions. `npm pack` leaves them in, and the `catalog:` protocol makes the tarball uninstallable by npm.

Never publish from a local checkout. Use the manual Publish workflow's default dry run to build and test a release tarball before uploading it to npm ([`CONTRIBUTING.md`](../../CONTRIBUTING.md#publishing-to-npm)).

## Acceptance scenarios

Test titles and comments use these IDs, so a test name says which behavior it checks. `smoke` is `test:smoke` and `e2e` is `test:e2e`, both on the installed tarball. The behavior itself is described for users in the [guide](../guide/README.md).

| ID | Behavior | Suite |
|---|---|---|
| S1 | With Claude Code, Codex, and Grok sessions in their default locations, the opened URL lists sessions from all three, with a count per agent | e2e |
| S2 | `estela <path>` opens that session's workspace | smoke, e2e |
| S3 | An agent whose home is missing (no `~/.codex`) shows 0 sessions and the checked path; the other agents load | e2e |
| S4 | A file in an unknown format generation is listed as "could not read"; its workspace shows agent, file, and line | e2e |
| S5 | Request bars rise to a dashed compaction rule labeled with the tokens before and after, and are lower after it | e2e |
| S6 | A timeline brush, dragged or moved with the arrow keys on a focused handle, filters the ledger and states the range and event count | e2e |
| S7 | Model saw at the first request after a compaction: slots with the recorded token counts, system prompt and tools only when a prompt snapshot records them at or before that request, and the removed events | e2e |
| S8 | A 10,000-event trace scrolls with fewer than 100 rendered rows and no long task over 200 ms | e2e |
| S9 | An exported report opens from `file://` without a server, in the export language, and contains no home path | e2e |
| S10 | `mcp` lists its tools, `reconstruct` returns the visible ids, unavailable slots, and completeness, and stdout carries only protocol | smoke, `apps/cli/test/cli-smoke.test.ts` |
| S11 | The theme follows the system color scheme; a manual switch survives a reload | e2e |
| S12 | A 350 MB Codex file opens after load progress, at most 12 MB reaches the browser before a selection, and a shortened output loads in full when selected | e2e, `packages/server/test/size-budget.test.ts` (opt-in) |
| S13 | On Node.js 22 the CLI prints one line naming Node.js 24 and exits 1 | smoke |
| S14 | A `zh-CN` browser gets Chinese labels and date formats with session content unchanged; a switch to English survives a reload | e2e |
| S15 | `build` piped to a file writes plain lines with no escape sequences and no home path | smoke |
| S16 | `--pick` in a terminal: typing part of a title and pressing Enter opens that session | smoke |
| S17 | `mcp` without a path lists seven tools with named input properties and walks list, summary, turns, requests, reconstruct, and get-event to a failed tool result ([MCP tools](../guide/mcp.md)) | smoke, `packages/server/test/agent-tools.test.ts` |
| S18 | MCP tool results on a hostile session hold no home path and no unsafe id as written (`@e0` instead), with `ESTELA_REDACT=0` | smoke, `packages/server/test/agent-tools.test.ts` |

Context diff (the Compare tab; [workspace guide](../guide/workspace.md#compare)):

| ID | Behavior | Evidence |
|---|---|---|
| CD-S1 | Across a compaction (pre 3.5k, post 400), the first request after it is compared with the last request before it: input tokens `3k → 600` and `−2.4k`, one compaction row `3.5k → 400`, the compaction summary among the entered events, and as many events hidden by compaction as Model saw lists as dropped | `compare.e2e.ts`, `packages/kernel/src/context-diff.test.ts` |
| CD-S2 | The last request compares with the previous one by default (no compaction, no hidden events); "Before the last compaction" picks the last request before it and shows one compaction row | `compare.e2e.ts`, `apps/web/src/lib/context-compare.test.ts` |
| CD-S3 | Shift-click on another main-lane request bar makes it the target, draws it with a dashed ring, and keeps the selection | `compare.e2e.ts` |
| CD-S4 | A slot the log does not record is hatched and `unavailable` with no change listed; without both input-token counts no difference is shown | `compare.e2e.ts`, `context-diff.test.ts` |
| CD-S5 | With prompt snapshots, the same recorded system prompt is "same" on the full and the view trace; tool names added and removed are listed, or "not recorded" when a definition has no name; tools first recorded after the earlier request are `unavailable` | `compare.e2e.ts`, `context-diff.test.ts` |
| CD-S6 | A request diffed with itself: nothing entered, left, or hidden, and an input-token delta of 0 when recorded | `context-diff.test.ts` |
| CD-S7 | In a report opened from `file://`, Compare gives the same diff, and switching to Chinese translates every label | `compare.e2e.ts` |
| CD-S8 | On a subagent lane the diff covers only that lane; the picker never offers another lane's request, and the kernel rejects a cross-lane pair with `different-lanes` | `context-diff.test.ts`, `context-compare.test.ts` |
| CD-S9 | With a non-request selected, or no other request on its lane, the tab says so in one line | `context-compare.test.ts` |

ATIF export ([export formats](../reference/export-formats.md)):

| ID | Behavior | Evidence |
|---|---|---|
| A1 | `fixtures/demo.trace.json` exports to ATIF that passes Harbor's validator; the compaction is a system step with `extra.context_management`, the events it hid produce no step, and steps kept from before it carry `is_copied_context: true` | `packages/kernel/src/export-atif.test.ts`, `apps/cli/src/export/write-export.test.ts`, `node scripts/validate-exports.mjs` |
| A2 | Every registered agent's conformance fixtures export to ATIF that passes Harbor's validator | `write-export.test.ts` (structural check in CI), `node scripts/validate-exports.mjs` (Harbor, manual) |

## CLI smoke on the installed tarball

`apps/e2e` (`@rivus/estela-e2e`, private) runs `pnpm pack` in `apps/cli`, installs the tarball into an empty temp directory, builds a synthetic `HOME` (also set as `USERPROFILE`, which Windows reads) from `fixtures/sessions/<agent>/conformance`, and puts a fake `open` / `xdg-open` first on `PATH` that records the URL instead of starting a browser. Windows has no such stand-in, because DevFrame opens the browser there through `cmd /c start`; the tests that check the opened URL pass `--no-open` on Windows and check the printed URL only. It covers `--help` (through `npx`), S2, S10, S17 and S18 (`mcp.smoke.ts`), S13 (Node.js 22 through `npx -y node@22`), S15, and S16 (in a pseudo-terminal through `node-pty`, pinned to `1.2.0-beta.18` because 1.1.0 ships no Linux prebuilds). It is not part of `pnpm test`, because it packs and installs. Setup first runs `pnpm --filter '@rivus/estela...' run build`, so the tarball never holds a stale bundle.

```bash
cd apps/e2e
pnpm run test:smoke
```

`TMPDIR` chooses where the temp directory goes. `ESTELA_SMOKE_KEEP=1` keeps it after the run. `ESTELA_SMOKE_NODE=<path to a node binary>` runs the installed CLI with that Node.js while the tests run on the workspace's. The install step needs the npm registry. The CLI runs with npm's update notifier, fund, and audit messages off, so its output is only its own. CI runs it in the `test` job on Linux with Node.js `^26.13.1`, and in the `platforms` job on Linux, macOS, and Windows with the CLI on Node.js 24 and 26.

## Browser end-to-end on the installed tarball

`test:e2e` in `apps/e2e` is the Playwright suite for the browser scenarios, Chromium only, against the same installed tarball. Its global setup (`src/e2e/global-setup.ts`) builds `@rivus/estela`, packs and installs it, builds synthetic homes from the agent fixtures (one with all three agents and an unreadable Claude Code file, one without `~/.codex`), and adds the fake opener. Each test starts its own server with `--port 0`, a fresh cache, and its own working directory, and stops it afterwards. Every test fails on a console error or a page error.

The test titles name the [scenarios](#acceptance-scenarios) they check, and each test file groups one area: the session browser, the workspace, appearance, the report, and scale.

```bash
cd apps/e2e
npx playwright install chromium                                   # once; CI adds --with-deps
pnpm run test:e2e
ESTELA_E2E_CHANNEL=chrome pnpm run test:e2e   # use the installed Google Chrome instead
```

S8 runs `scripts/generate-trace.mjs` and S12 runs `packages/server/src/testsupport/large-session.ts` by path, both into the run's temp directory, and delete the output; nothing generated is committed. `ESTELA_E2E_S12_BYTES` changes the S12 size for a quick local try; the default, and the value CI uses, is 350 MiB (367,001,600 bytes). `ESTELA_E2E_KEEP=1` keeps the temp directory. With `CI` set, the suite also writes an HTML report to `apps/e2e/playwright-report/`, which the CI job uploads when a test fails. CI runs the suite in the `test` job on Node.js `^26.13.1` only.

## Check in a real browser

Before a UI change is done, check it in a real browser with the dev server on a synthetic `HOME`. The web app is served from `apps/web/dist`, so rebuild it after a UI change:

```bash
pnpm --filter @rivus/estela-web run build
```

### Synthetic home and generated traces

Build a home from the agent fixtures (no real session content):

```bash
H="$TMPDIR/estela-home"; rm -rf "$H"
mkdir -p "$H/.claude/projects" "$H/.codex/sessions/2026/09/25" "$H/.grok/sessions"
for f in plain compaction subagent; do
  mkdir -p "$H/.claude/projects/app-$f"
  cp -R fixtures/sessions/claude-code/conformance/$f/* "$H/.claude/projects/app-$f/"
done
mkdir -p "$H/.claude/projects/app-bad"
cp fixtures/sessions/claude-code/unknown-generation/session.jsonl "$H/.claude/projects/app-bad/"
for f in plain compaction token-count subagent; do
  cp fixtures/sessions/codex/conformance/rollout-$f.jsonl "$H/.codex/sessions/2026/09/25/"
done
for f in plain compaction subagent; do
  cp -R fixtures/sessions/grok/conformance/$f "$H/.grok/sessions/grok-$f"
done
```

`scripts/generate-trace.mjs` writes a synthetic canonical trace shaped like a Claude Code session (turns, growing input tokens, tool calls, failures, long outputs, hook runs, two subagent lanes, compactions). Open it by path:

```bash
node scripts/generate-trace.mjs --events 640 --name design.trace.json   # about the size of the design mockup
node scripts/generate-trace.mjs --events 10000 --name s8.trace.json      # S8
HOME="$H" XDG_CACHE_HOME="$TMPDIR/estela-cache" \
  node apps/cli/bin.mjs "$TMPDIR/estela-generated/design.trace.json" --no-auth --no-open --port 7461
```

For S12, write the 350 MB Codex-format file into a second home and open it from the session list, so the browser sees the load progress:

```bash
mkdir -p "$TMPDIR/estela-big/.codex/sessions/2026/09/25"
node -e "import('./packages/server/src/testsupport/large-session.ts').then(m => m.writeLargeCodexSession(process.argv[1], { targetBytes: 350e6 }))" \
  "$TMPDIR/estela-big/.codex/sessions/2026/09/25"
HOME="$TMPDIR/estela-big" XDG_CACHE_HOME="$TMPDIR/estela-cache-big" node apps/cli/bin.mjs --no-auth --no-open --port 7464
```

Delete the generated files when done.

### Driving the browser

`chrome-devtools-mcp` starts its own headless Chrome; always pass the two opt-out flags, because by default it sends usage statistics to Google and may send trace URLs to the CrUX API:

```bash
npx -y chrome-devtools-mcp@1.10.1 --headless --isolated --no-usage-statistics --no-performance-crux
```

Drive it over stdio from an MCP client. Useful tools: `new_page`, `emulate` (`viewport: 1440x900x1`, `colorScheme`), `take_screenshot`, `evaluate_script`, `list_console_messages`, `performance_start_trace`. Add `--chromeArg=--lang=zh-CN --chromeArg=--accept-lang=zh-CN` for the Chinese UI. Playwright (`playwright-core` with `channel: 'chrome'`, installed in a scratch directory outside the repository) works too; set `viewport`, `colorScheme`, and `locale` on the context.

What to check for a workspace change:

- Screenshots at 1440 × 900 of `#/s/<traceId>` in dark and light, English and `zh-CN`, next to `docs/design/session-workspace-{dark,light}.html` at the same size. List every visible difference.
- S5: on the Claude Code compaction fixture, the timeline has one `[data-marker=compaction]` whose `data-label` is `compacted  1k → 100`.
- S6: drag on `[data-testid=timeline-plot]`; `[data-testid=timeline-range]` states the range and the event count. Focus `[data-testid=brush-from]` and press the arrow keys (Shift for 10 % steps); `aria-valuenow` changes.
- S7: select the request after the compaction and open "Model saw": on a session without prompt snapshots `[data-slot=system]` and `[data-slot=tools]` have `data-status="unavailable"`; on one with snapshots (Claude Code, seen from 2.1.268) they have `data-status="present"`, and each row's `[data-testid=slot-source]` selects the snapshot. At request #1 of the snapshot session, tools are `unavailable` with the "only after this event" note. `[data-testid=dropped]` lists the removed events.
- S8: on the 10,000-event trace, scroll `[data-testid=ledger]` to the bottom while counting `[role=option]` elements (under 100) and collecting `PerformanceObserver` `longtask` entries (none over 200 ms). Record a performance trace of the scroll.
- S12: the loading panel shows bytes read of the file size; after the load a `[data-testid=shortened]` marker is visible, and selecting its row loads the full text.
- The console has no errors or warnings. Keep screenshots and traces out of the repository.

Set `ESTELA_REDACT=0` only when debugging redaction on the local server; `build` always redacts.
