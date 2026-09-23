# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
./scripts/install-git-hooks.sh
node common/scripts/install-run-rush.js update
```

Use Node.js 22.18 or later. `rush.json` still allows `>=20.11.0 <25`, but the CLI imports `.ts` directly and `adapter-opencode` uses `node:sqlite`; both fail on 20.x and on 22 before 22.18.

## Checks

```bash
./scripts/check-repository.sh
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
```

## Run the UI

```bash
cd packages/devframe
node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```

Open `http://localhost:7392/__agent-trace/`.

`AGENT_TRACE_PATH` selects the session. Unset, the app loads `fixtures/demo.trace.json`.

OpenCode needs a session id in the path: `opencode.db#ses_...`. Set `AGENT_TRACE_REDACT=0` only when debugging redaction locally.
