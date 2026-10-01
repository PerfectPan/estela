# agent-trace

Local-first DevTool for coding-agent session logs.

- **Session** is the archive (`events[]`).
- **Trajectory** is a fold of that archive.
- **Reconstruct** shows what the model still saw at one event after compaction.

## Quick start

Node.js 22.18 or later:

```sh
npx @rivus/agent-trace                  # session browser over this machine's sessions
npx @rivus/agent-trace <session-path>   # one session's workspace
npx @rivus/agent-trace --pick           # pick a session in the terminal
npx @rivus/agent-trace build <session-path> --out-dir report
npx @rivus/agent-trace mcp <session-path>
```

`@rivus/agent-trace` is not published yet. Until then, build and run it from this repository:

```sh
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js build
cd apps/cli && node dist/bin.mjs --no-auth
```

For development, `cd apps/cli && node ../../common/scripts/install-run-rushx.js dev -- --no-auth` runs the CLI from source. Open `http://localhost:7392/__agent-trace/`.

`build` and `mcp` default to `fixtures/demo.trace.json` when no path is given. `AGENT_TRACE_PATH` sets the default session path.

| Host | Path | Status |
|---|---|---|
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | loads |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | loads |
| Claude Code | `~/.claude/projects/` | loads |
| OpenCode | `opencode.db#<session-id>` | package kept, not registered |
| dsh | — | package kept, not registered |

Rush monorepo. UI is Solid + Tailwind v4 + shadcn-solid. Lint is oxlint.

Current behavior: [docs/architecture/overview.md](docs/architecture/overview.md). Local commands: [docs/development/setup.md](docs/development/setup.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
