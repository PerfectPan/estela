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

## Check in a real browser

Before a UI change is done, check it in a real browser (D16) with the dev server on a synthetic `HOME`. `chrome-devtools-mcp` starts its own headless Chrome; always pass the two opt-out flags, because by default it sends usage statistics to Google and may send trace URLs to the CrUX API:

```bash
npx -y chrome-devtools-mcp@1.10.1 --headless --isolated --no-usage-statistics --no-performance-crux
```

Drive it over stdio from an MCP client. Useful tools: `new_page`, `emulate` (`viewport: 1440x900x1`, `colorScheme`), `take_screenshot`, `evaluate_script`, `list_console_messages`. Add `--chromeArg=--lang=zh-CN --chromeArg=--accept-lang=zh-CN` for the Chinese UI. Compare screenshots with `docs/design/*.html` at 1440 × 900, both themes and both languages, and check that the console is empty. Keep screenshots out of the repository. M4 finishes this section.

`host-opencode` and `host-dsh` are not registered. Set `AGENT_TRACE_REDACT=0` only when debugging redaction on the local server; `build` always redacts.
