# agent-trace

Local-first DevTool for coding-agent session logs.

- **Session** is the archive (`events[]`).
- **Trajectory** is a fold of that archive.
- **Reconstruct** shows what the model still saw at one event after compaction.

## Quick start

```sh
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js test
cd apps/cli && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```

Open `http://localhost:7392/__agent-trace/`.

Default fixture: `fixtures/demo.trace.json`. Pass a path, or set `AGENT_TRACE_PATH`, to inspect a real log.

| Host | Path | Status |
|---|---|---|
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | loads |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | loads |
| Claude Code | `~/.claude/projects/` | detect only |
| OpenCode | `opencode.db#<session-id>` | package kept, not registered |
| dsh | — | package kept, not registered |

Rush monorepo. UI is Solid + Tailwind v4 + shadcn-solid. Lint is oxlint.

Current behavior: [docs/architecture/overview.md](docs/architecture/overview.md). Local commands: [docs/development/setup.md](docs/development/setup.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
