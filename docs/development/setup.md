# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
./scripts/install-git-hooks.sh
node common/scripts/install-run-rush.js update
```

Use Node.js 22.18 or later. `rush.json` requires `>=22.18.0 <25`, and the CLI exits before loading when Node is older.

## Checks

```bash
./scripts/check-repository.sh
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

A positional path selects the session. With no path, `AGENT_TRACE_PATH` is used. With neither, the app loads `fixtures/demo.trace.json`.

`host-opencode` and `host-dsh` are not registered. Set `AGENT_TRACE_REDACT=0` only when debugging redaction on the local server; `build` always redacts.
