# agent-trace

Local-first DevTool for coding-agent session logs.

- **Session** is the archive (`events[]`).
- **Trajectory** is a fold of that archive.
- **Reconstruct** shows what the model still saw at one event after compaction.

## Quick start

```sh
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js test
cd packages/devframe && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```

Open `http://localhost:7392/__agent-trace/`.

Default fixture: `fixtures/demo.trace.json`. Point `AGENT_TRACE_PATH` at a host session to inspect a real log.

| Host | Path | Status |
|---|---|---|
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | loads |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | loads |
| OpenCode | `~/.local/share/opencode/opencode.db#<session-id>` | loads |
| Claude Code | — | not supported |
| dsh | — | not supported |

Rush monorepo. UI is Solid + Tailwind v4 + shadcn-solid. Lint is oxlint.

Current behavior: [docs/architecture/overview.md](docs/architecture/overview.md). Local commands: [docs/development/setup.md](docs/development/setup.md).
