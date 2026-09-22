# Development

Audience: someone running or testing the viewer locally.

## Setup

```bash
./scripts/install-git-hooks.sh
node common/scripts/install-run-rush.js update
```

Node.js must satisfy `>=20.11.0 <25` from `rush.json`.

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
