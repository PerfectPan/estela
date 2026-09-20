# agent-trace

Local-first DevTool for coding-agent session logs.

- **Session** is the archive (`events[]`).
- **Trajectory** is a fold of that archive.
- **Killer:** at any event, reconstruct what the model actually saw after compaction.

Monorepo is **Rush** (pnpm under the hood). UI is **Solid + Tailwind v4 + shadcn-solid**. Lint is **oxlint**.

```sh
rush update
rush test
rush typecheck
rush lint
cd packages/devframe && rushx dev -- --no-auth
```

Default demo fixture: `fixtures/demo.trace.json`. Override with `AGENT_TRACE_PATH`.

Hosts:

| Host | Path |
|---|---|
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` |
| OpenCode | `~/.local/share/opencode/opencode.db#<session-id>` |
| Claude Code | stub |
| dsh | stub |

See [docs/VISION.md](docs/VISION.md).
