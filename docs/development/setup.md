# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
pnpm install
```

Use Node.js 26.13.1: the root `package.json` pins this development runtime. The built CLI runs on Node.js 24 or later and exits before loading when Node is older.

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
pnpm build
```

## Run the UI

```bash
cd apps/cli
pnpm run dev -- --no-auth
```

Open `http://localhost:7392/__agent-trace/`.

With no path the app opens the session browser over every registered agent. A positional path (or `AGENT_TRACE_PATH`) is loaded before the server listens and opens `#/s/<traceId>`. `--pick` lists the sessions in the terminal. `build` and `mcp` still default to `fixtures/demo.trace.json`.

`build <path> --out-dir <dir>` writes the report as one `<dir>/index.html`; open it straight from disk. "Export report" in the workspace writes the same into a new `agent-trace-report-<traceId>-<time>/` directory under the server's working directory and shows the path.

The session index lives at `$XDG_CACHE_HOME/rivus-agent-trace/index.sqlite`, or `~/.cache/rivus-agent-trace/index.sqlite` when `XDG_CACHE_HOME` is unset. It is a cache: delete it at any time. `--no-index` runs without reading or writing it (search then covers titles and first prompts only). Point `HOME` at a directory with fixture sessions to run against synthetic data:

```bash
HOME=/tmp/agent-trace-home node apps/cli/bin.mjs --no-auth --no-open
```

## Bundle and tarball

`pnpm --filter '@rivus/agent-trace...' run build` builds `apps/cli` with `vp pack` (the `pack` blocks of `apps/cli/vite.config.ts`):

- `dist/bin.mjs` is the package `bin`, built from `apps/cli/bin.mjs`. It checks the Node.js version and drops the `node:sqlite` ExperimentalWarning, then imports `dist/cli.mjs` (from source, the same file imports `src/main.ts`).
- `dist/cli.mjs` bundles the shell, every `@rivus/*` workspace package, and `@clack/prompts`. `devframe`, `@devframes/agentic`, and `cac` stay external as the package's only runtime dependencies. `@devframes/agentic` declares an exact `devframe` peer dependency, so the two stay pinned to the same version.
- `dist/web/` is a copy of `apps/web/dist`, and `dist/fixtures/demo.trace.json` is the default session for `build` and `mcp`. `src/paths.ts` picks these locations when the pack config defines `AGENT_TRACE_BUNDLE`; run from source (`node bin.mjs`), it uses `apps/web/dist` and `fixtures/` in the workspace.
- `dist/THIRD-PARTY-NOTICES.txt` holds the license texts of the npm packages bundled into `cli.mjs` and of those the web build is made from, Vite and Rolldown included through vite-plus-core; the CLI section lists Rolldown too, for the runtime helpers in `cli.mjs` and `bin.mjs` (`apps/cli/scripts/third-party-notices.ts`, a Rolldown plugin).

```bash
pnpm --filter '@rivus/agent-trace...' run build
cd apps/cli
node dist/bin.mjs --help          # the bundle, from the workspace
pnpm pack --pack-destination /tmp  # the tarball; `files` ships dist (with THIRD-PARTY-NOTICES.txt), README.md, LICENSE, CHANGELOG.md once versioned
```

`pnpm pack` rewrites the `workspace:` and `catalog:` specifiers in the manifest into real versions. `npm pack` leaves them in, and the `catalog:` protocol makes the tarball uninstallable by npm.

Never publish from a local checkout. Use the manual Publish workflow's default dry run to build and test a release tarball before uploading it to npm ([`CONTRIBUTING.md`](../../CONTRIBUTING.md#publishing-to-npm)).

## Acceptance scenarios

Test titles and comments use these IDs. `smoke` is `test:smoke` and `e2e` is `test:e2e`, both on the installed tarball.

| ID | Behavior | Suite |
|---|---|---|
| S1 | With Claude Code, Codex, and Grok sessions in their default locations, the opened URL lists sessions from all three, with a count per agent | e2e |
| S2 | `agent-trace <path>` opens that session's workspace | smoke, e2e |
| S3 | An agent whose home is missing (no `~/.codex`) shows 0 sessions and the checked path; the other agents load | e2e |
| S4 | A file in an unknown format generation is listed as "could not read"; its workspace shows agent, file, and line | e2e |
| S5 | Request bars rise to a dashed compaction rule labeled with the tokens before and after, and are lower after it | e2e |
| S6 | A timeline brush, dragged or moved with the arrow keys on a focused handle, filters the ledger and states the range and event count | e2e |
| S7 | Model saw at the first request after a compaction: slots with the recorded token counts, system prompt and tools only when a prompt snapshot records them at or before that request, and the removed events | e2e |
| S8 | A 10,000-event trace scrolls with fewer than 100 rendered rows and no long task over 200 ms | e2e |
| S9 | An exported report opens from `file://` without a server, in the export language, and contains no home path | e2e |
| S10 | `mcp` lists its tools, `reconstruct` returns the visible ids, unavailable slots, and completeness, and stdout carries only protocol | smoke, `apps/cli/src/smoke.test.ts` |
| S11 | The theme follows the system color scheme; a manual switch survives a reload | e2e |
| S12 | A 350 MB Codex file opens after load progress, at most 12 MB reaches the browser before a selection, and a shortened output loads in full when selected | e2e, `apps/cli/src/size-budget.test.ts` (opt-in) |
| S13 | On Node.js 22 the CLI prints one line naming Node.js 24 and exits 1 | smoke |
| S14 | A `zh-CN` browser gets Chinese labels and date formats with session content unchanged; a switch to English survives a reload | e2e |
| S15 | `build` piped to a file writes plain lines with no escape sequences and no home path | smoke |
| S16 | `--pick` in a terminal: typing part of a title and pressing Enter opens that session | smoke |

## CLI smoke on the installed tarball

`apps/e2e` (`@rivus/agent-trace-e2e`, private) runs `pnpm pack` in `apps/cli`, installs the tarball into an empty temp directory, builds a synthetic `HOME` from `fixtures/sessions/<agent>/conformance`, and puts a fake `open` / `xdg-open` first on `PATH` that records the URL instead of starting a browser. It covers `--help` (through `npx`), S2, S10, S13 (Node.js 22 through `npx -y node@22`), S15, and S16 (in a pseudo-terminal through `node-pty`, pinned to `1.2.0-beta.15` because 1.1.0 ships no Linux prebuilds). It is not part of `pnpm test`, because it packs and installs. Setup first runs `pnpm --filter '@rivus/agent-trace...' run build`, so the tarball never holds a stale bundle.

```bash
cd apps/e2e
pnpm run test:smoke
```

`TMPDIR` chooses where the temp directory goes. `AGENT_TRACE_SMOKE_KEEP=1` keeps it after the run. The install step needs the npm registry. The CLI runs with npm's update notifier, fund, and audit messages off, so its output is only its own. CI runs it in the `test` job on Node.js 26.13.1.

## Browser end-to-end on the installed tarball

`test:e2e` in `apps/e2e` is the Playwright suite for the browser scenarios, Chromium only, against the same installed tarball. Its global setup (`src/e2e/global-setup.ts`) builds `@rivus/agent-trace`, packs and installs it, builds synthetic homes from the agent fixtures (one with all three agents and an unreadable Claude Code file, one without `~/.codex`), and adds the fake opener. Each test starts its own server with `--port 0`, a fresh cache, and its own working directory, and stops it afterwards. Every test fails on a console error or a page error.

The test titles name the [scenarios](#acceptance-scenarios) they check, and each test file groups one area: the session browser, the workspace, appearance, the report, and scale.

```bash
cd apps/e2e
npx playwright install chromium                                   # once; CI adds --with-deps
pnpm run test:e2e
AGENT_TRACE_E2E_CHANNEL=chrome pnpm run test:e2e   # use the installed Google Chrome instead
```

S8 runs `scripts/generate-trace.mjs` and S12 runs `apps/cli/src/testsupport/large-session.ts` by path, both into the run's temp directory, and delete the output; nothing generated is committed. `AGENT_TRACE_E2E_S12_BYTES` changes the S12 size for a quick local try; the default, and the value CI uses, is 350 MiB (367,001,600 bytes). `AGENT_TRACE_E2E_KEEP=1` keeps the temp directory. With `CI` set, the suite also writes an HTML report to `apps/e2e/playwright-report/`, which the CI job uploads when a test fails. CI runs the suite in the `test` job on Node.js 26.13.1 only.

## Check in a real browser

Before a UI change is done, check it in a real browser with the dev server on a synthetic `HOME`. The web app is served from `apps/web/dist`, so rebuild it after a UI change:

```bash
pnpm --filter @rivus/agent-trace-web run build
```

### Synthetic home and generated traces

Build a home from the agent fixtures (no real session content):

```bash
H="$TMPDIR/agent-trace-home"; rm -rf "$H"
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
HOME="$H" XDG_CACHE_HOME="$TMPDIR/agent-trace-cache" \
  node apps/cli/bin.mjs "$TMPDIR/agent-trace-generated/design.trace.json" --no-auth --no-open --port 7461
```

For S12, write the 350 MB Codex-format file into a second home and open it from the session list, so the browser sees the load progress:

```bash
mkdir -p "$TMPDIR/agent-trace-big/.codex/sessions/2026/09/25"
node -e "import('./apps/cli/src/testsupport/large-session.ts').then(m => m.writeLargeCodexSession(process.argv[1], { targetBytes: 350e6 }))" \
  "$TMPDIR/agent-trace-big/.codex/sessions/2026/09/25"
HOME="$TMPDIR/agent-trace-big" XDG_CACHE_HOME="$TMPDIR/agent-trace-cache-big" node apps/cli/bin.mjs --no-auth --no-open --port 7464
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

Set `AGENT_TRACE_REDACT=0` only when debugging redaction on the local server; `build` always redacts.
