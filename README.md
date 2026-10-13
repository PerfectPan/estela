# agent-trace

`@rivus/agent-trace` is a local DevTools for coding-agent session logs. One command opens it in the browser. You pick a session from Claude Code, Codex, or Grok and see, on one screen, what the agent did and what the model was shown at each request.

- **Session browser**: every session found on this machine, newest first, grouped by day. Each row has the host, title, project, turns, requests, tokens, duration, last activity, and flags for compaction, subagents, and failed tool calls. Filters by host, project, and flag; search covers titles and the user's own prompts. Selecting a row shows a preview with the context-over-time shape.
- **Session workspace**: a header with the session's numbers; a timeline with one bar per model request (height is input tokens), a lane per subagent, markers for prompts and failed tool calls, and a dashed rule at each compaction; a ledger of events grouped by turn; and an inspector whose "Model saw" tab reconstructs the context at the selected request, with the slots the session log does not record marked "unavailable".
- **Report**: a redacted copy of one session's workspace as a single `index.html` that opens from disk.

The screens are described in words here. Screenshots are not committed; the design mockups are in [`docs/design/`](docs/design/README.md).

## Quick start

Node.js 24 or later:

```sh
npx @rivus/agent-trace
```

This starts a server on `localhost`, indexes the sessions of the supported hosts, and opens the session browser. `@rivus/agent-trace` is not published yet. Until then, build it from this repository and run the bundle. The build needs Node.js 24.x, because `rush.json` allows `>=24.0.0 <25`; the built CLI runs on Node.js 24 or later:

```sh
node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build
node apps/cli/dist/bin.mjs
```

## Commands

```sh
npx @rivus/agent-trace [path] [--port <n>] [--host <host>] [--no-open] [--no-auth] [--pick] [--no-index]
npx @rivus/agent-trace build [path] [--out-dir <dir>]
npx @rivus/agent-trace mcp [path]
```

| Command | What it does |
|---|---|
| `agent-trace` | Session browser for this machine. |
| `agent-trace <path>` | Loads that session before the server listens (exit 1 with the reason if no host accepts it), then opens its workspace. |
| `agent-trace --pick` | Searchable session list in the terminal; Enter opens the chosen session. Needs an interactive terminal. |
| `agent-trace build <path> --out-dir <dir>` | Writes the report of one session to `<dir>/index.html` (default `dist-static`). |
| `agent-trace mcp <path>` | MCP server over stdio with a `reconstruct` tool for that session. Only protocol messages go to stdout. |

| Flag | Meaning |
|---|---|
| `--port <n>` | Port (default 7392; `0` picks a free one). |
| `--host <host>` | Bind address (default `localhost`). |
| `--no-open` | Print the URL; do not open a browser. |
| `--no-auth` | Turn off DevFrame's one-time-code gate. By default the opened URL carries the code. |
| `--pick` | Pick the session in the terminal. |
| `--no-index` | Do not read or write the session index; summaries are computed again on each launch and not stored. |

`AGENT_TRACE_PATH` is the default session path. `build` and `mcp` fall back to a bundled demo trace when no path is given. When output is not a terminal, or `NO_COLOR` is set, the CLI prints plain lines with no escape sequences.

## Supported hosts

| Host | Where sessions are found | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/` | loads |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`, `~/.codex/archived_sessions/**/rollout-*.jsonl` | loads |
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | loads |
| OpenCode | `opencode.db#<session-id>` | package kept, not registered |
| dsh | — | package kept, not registered |

The agents' home overrides apply and replace the default home: `CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex, `GROK_HOME` for Grok — with `CLAUDE_CONFIG_DIR` set, sessions only under `~/.claude` are not listed.

A host whose folder does not exist shows 0 sessions and the path it checked. A file the host adapter cannot parse is listed as "could not read" with the file, line, and reason. A line inside a session that is not JSON is skipped and does not fail the session.

## Privacy

- Everything runs on this machine. The server binds `localhost`, and nothing is sent anywhere.
- Session files are read, never written.
- The session index lives at `$XDG_CACHE_HOME/rivus-agent-trace/index.sqlite` (default `~/.cache/rivus-agent-trace/`), with mode 0600. It holds titles, paths, numbers, and the first 200 prompts the user typed, 500 characters each, for search — not the text the host injected or recorded itself. Deleting it is safe; it is rebuilt from the logs. `--no-index` runs without it.
- URLs carry opaque session refs, never paths.
- The local server replaces the home directory with `~` and known credential patterns with placeholders; `AGENT_TRACE_REDACT=0` turns that off for the local server only.
- A report (`build`, or "Export report" in the workspace) is always redacted the same way, whatever `AGENT_TRACE_REDACT` says. Session text and file contents remain in it, so read a report before you share it. It holds the view of every event and the original records of the first 2,000 events or 20 MB, whichever is smaller; its header says when it holds fewer.

## Development

Rush monorepo; the UI is Solid, Tailwind v4, and shadcn-solid; lint is oxlint. Current behavior: [docs/architecture/overview.md](docs/architecture/overview.md). Local commands, the tarball, and the smoke and browser test suites: [docs/development/setup.md](docs/development/setup.md). Contribution rules: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
