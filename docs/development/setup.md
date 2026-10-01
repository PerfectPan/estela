# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
node common/scripts/install-run-rush.js update
```

Use Node.js 22.18 or later. `rush.json` requires `>=22.18.0 <25`, and the CLI exits before loading when Node is older.

## Checks

```bash
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/release-intent.mjs check --base "$(git merge-base origin/main HEAD)"
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
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

`TMPDIR` chooses where the temp directory goes. `AGENT_TRACE_SMOKE_KEEP=1` keeps it after the run. The install step needs the npm registry. The CLI runs with npm's update notifier, fund, and audit messages off, so its output is only its own. CI runs this job on Node.js 22.18 and 24.

## Check in a real browser

Before a UI change is done, check it in a real browser (D16) with the dev server on a synthetic `HOME`. `chrome-devtools-mcp` starts its own headless Chrome; always pass the two opt-out flags, because by default it sends usage statistics to Google and may send trace URLs to the CrUX API:

```bash
npx -y chrome-devtools-mcp@1.10.1 --headless --isolated --no-usage-statistics --no-performance-crux
```

Drive it over stdio from an MCP client. Useful tools: `new_page`, `emulate` (`viewport: 1440x900x1`, `colorScheme`), `take_screenshot`, `evaluate_script`, `list_console_messages`. Add `--chromeArg=--lang=zh-CN --chromeArg=--accept-lang=zh-CN` for the Chinese UI. Compare screenshots with `docs/design/*.html` at 1440 × 900, both themes and both languages, and check that the console is empty. Keep screenshots out of the repository. M4 finishes this section.

`host-opencode` and `host-dsh` are not registered. Set `AGENT_TRACE_REDACT=0` only when debugging redaction on the local server; `build` always redacts.
