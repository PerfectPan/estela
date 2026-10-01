# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
node common/scripts/install-run-rush.js install
```

Use Node.js 24.x: `rush.json` requires `>=24.0.0 <25`. The built CLI runs on Node.js 24 or later and exits before loading when Node is older.

## Checks

```bash
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/release-intent.mjs check --base "$(git merge-base origin/main HEAD)"
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
node scripts/format.mjs --check
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
```

## Run the UI

```bash
cd apps/cli
node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```

Open `http://localhost:7392/__agent-trace/`.

With no path the app opens the session browser over every registered host. A positional path (or `AGENT_TRACE_PATH`) is loaded before the server listens and opens `#/s/<ref>`. `--pick` lists the sessions in the terminal. `build` and `mcp` still default to `fixtures/demo.trace.json`.

`build <path> --out-dir <dir>` writes the report as one `<dir>/index.html`; open it straight from disk. "Export report" in the workspace writes the same into a new `agent-trace-report-<ref>-<time>/` directory under the server's working directory and shows the path.

The session index lives at `$XDG_CACHE_HOME/rivus-agent-trace/index.sqlite`, or `~/.cache/rivus-agent-trace/index.sqlite` when `XDG_CACHE_HOME` is unset. It is a cache: delete it at any time. `--no-index` runs without reading or writing it (search then covers titles and first prompts only). Point `HOME` at a directory with fixture sessions to run against synthetic data:

```bash
HOME=/tmp/agent-trace-home node apps/cli/bin.mjs --no-auth --no-open
```

## Bundle and tarball

`rush build` builds `apps/cli` with rslib (`apps/cli/rslib.config.ts`, D11):

- `dist/bin.mjs` is the package `bin`, built from `apps/cli/bin.mjs`. It checks the Node.js version and drops the `node:sqlite` ExperimentalWarning, then imports `dist/cli.mjs` (from source, the same file imports `src/main.ts`).
- `dist/cli.mjs` bundles the shell, every `@rivus/*` workspace package, and `@clack/prompts`. `devframe`, `@devframes/agentic`, and `cac` stay external as the package's only runtime dependencies.
- `dist/web/` is a copy of `apps/web/dist`, and `dist/fixtures/demo.trace.json` is the default session for `build` and `mcp`. `src/paths.ts` picks these locations when rslib defines `AGENT_TRACE_BUNDLE`; run from source (`node bin.mjs`), it uses `apps/web/dist` and `fixtures/` in the workspace.
- `dist/THIRD-PARTY-NOTICES.txt` holds the license texts of the npm packages bundled into `cli.mjs` and of those the web build is made from (`apps/cli/scripts/third-party-notices.ts`).

```bash
node common/scripts/install-run-rush.js build --to @rivus/agent-trace
cd apps/cli
node dist/bin.mjs --help          # the bundle, from the workspace
npm pack --pack-destination /tmp  # the tarball; `files` ships dist (with THIRD-PARTY-NOTICES.txt), README.md, LICENSE, CHANGELOG.md
```

Never publish from a local checkout.

## CLI smoke on the installed tarball

`apps/e2e` (`@rivus/agent-trace-e2e`, private) runs `npm pack` in `apps/cli`, installs the tarball into an empty temp directory, builds a synthetic `HOME` from `packages/host-*/fixtures/conformance`, and puts a fake `open` / `xdg-open` first on `PATH` that records the URL instead of starting a browser. It covers `--help` (through `npx`), S2, S10, S13 (Node.js 20 through `npx -y node@20`), S15, and S16 (in a pseudo-terminal through `node-pty`). It is not part of `rush test`, because it packs and installs. Setup first runs `node common/scripts/install-run-rush.js build --to @rivus/agent-trace`, so the tarball never holds a stale bundle; Rush skips the projects whose inputs did not change.

```bash
cd apps/e2e
node ../../common/scripts/install-run-rushx.js test:smoke
```

`TMPDIR` chooses where the temp directory goes. `AGENT_TRACE_SMOKE_KEEP=1` keeps it after the run. The install step needs the npm registry. The CLI runs with npm's update notifier, fund, and audit messages off, so its output is only its own. CI runs it in the `test` job on Node.js 24.

## Browser end-to-end on the installed tarball

`test:e2e` in `apps/e2e` is the Playwright suite (plan 5.2), Chromium only, against the same installed tarball. Its global setup (`src/e2e/global-setup.ts`) builds `@rivus/agent-trace`, packs and installs it, builds synthetic homes from the host fixtures (one with all three hosts and an unreadable Claude Code file, one without `~/.codex`), and adds the fake opener. Each test starts its own server with `--port 0`, a fresh cache, and its own working directory, and stops it afterwards. Every test fails on a console error or a page error.

The test titles name the scenarios of plan 5.2 they check, and each test file groups one area: the session browser, the workspace, appearance, the report, and scale.

```bash
cd apps/e2e
npx playwright install chromium                                   # once; CI adds --with-deps
node ../../common/scripts/install-run-rushx.js test:e2e
AGENT_TRACE_E2E_CHANNEL=chrome node ../../common/scripts/install-run-rushx.js test:e2e   # use the installed Google Chrome instead
```

S8 runs `scripts/generate-trace.mjs` and S12 runs `packages/host-codex/testing/large-session.ts` by path, both into the run's temp directory, and delete the output; nothing generated is committed. `AGENT_TRACE_E2E_S12_BYTES` changes the S12 size for a quick local try; the default, and the value CI uses, is 350 MiB (367,001,600 bytes). `AGENT_TRACE_E2E_KEEP=1` keeps the temp directory. With `CI` set, the suite also writes an HTML report to `apps/e2e/playwright-report/`, which the CI job uploads when a test fails. CI runs the suite in the `tarball` job on Node.js 24 only.

## Check in a real browser

Before a UI change is done, check it in a real browser (D16) with the dev server on a synthetic `HOME`. The web app is served from `apps/web/dist`, so rebuild it after a UI change:

```bash
node common/scripts/install-run-rush.js build --to @rivus/agent-trace-web
```

### Synthetic home and generated traces

Build a home from the host fixtures (no real session content):

```bash
H="$TMPDIR/agent-trace-home"; rm -rf "$H"
mkdir -p "$H/.claude/projects" "$H/.codex/sessions/2026/09/25" "$H/.grok/sessions"
for f in plain compaction subagent; do
  mkdir -p "$H/.claude/projects/app-$f"
  cp -R packages/host-claude-code/fixtures/conformance/$f/* "$H/.claude/projects/app-$f/"
done
mkdir -p "$H/.claude/projects/app-bad"
cp packages/host-claude-code/fixtures/unknown-generation/session.jsonl "$H/.claude/projects/app-bad/"
for f in plain compaction token-count subagent; do
  cp packages/host-codex/fixtures/conformance/rollout-$f.jsonl "$H/.codex/sessions/2026/09/25/"
done
for f in plain compaction subagent; do
  cp -R packages/host-grok/fixtures/conformance/$f "$H/.grok/sessions/grok-$f"
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
node -e "import('./packages/host-codex/testing/large-session.ts').then(m => m.writeLargeCodexSession(process.argv[1], { targetBytes: 350e6 }))" \
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

- Screenshots at 1440 × 900 of `#/s/<ref>` in dark and light, English and `zh-CN`, next to `docs/design/session-workspace-{dark,light}.html` at the same size. List every visible difference.
- S5: on the Claude Code compaction fixture, the timeline has one `[data-marker=compaction]` whose `data-label` is `compacted  1k → 100`.
- S6: drag on `[data-testid=timeline-plot]`; `[data-testid=timeline-range]` states the range and the event count. Focus `[data-testid=brush-from]` and press the arrow keys (Shift for 10 % steps); `aria-valuenow` changes.
- S7: select the request after the compaction and open "Model saw": on a session without prompt snapshots `[data-slot=system]` and `[data-slot=tools]` have `data-status="unavailable"`; on one with snapshots (Claude Code, seen from 2.1.268) they have `data-status="present"`, and each row's `[data-testid=slot-source]` selects the snapshot. At request #1 of the snapshot session, tools are `unavailable` with the "only after this event" note. `[data-testid=dropped]` lists the removed events.
- S8: on the 10,000-event trace, scroll `[data-testid=ledger]` to the bottom while counting `[role=option]` elements (under 100) and collecting `PerformanceObserver` `longtask` entries (none over 200 ms). Record a performance trace of the scroll.
- S12: the loading panel shows bytes read of the file size; after the load a `[data-testid=shortened]` marker is visible, and selecting its row loads the full text.
- The console has no errors or warnings. Keep screenshots and traces out of the repository.

`host-opencode` and `host-dsh` are not registered. Set `AGENT_TRACE_REDACT=0` only when debugging redaction on the local server; `build` always redacts.
