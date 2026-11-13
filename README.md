<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="Estela">
</p>

<h1 align="center">Estela</h1>

<p align="center">
  <strong>Local DevTools for Agent session logs</strong><br>
  Session browser · request timeline · context reconstruction
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rivus/estela"><img src="https://img.shields.io/npm/v/@rivus/estela?style=flat-square" alt="npm version"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@rivus/estela?style=flat-square" alt="Node.js 24 or later"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@rivus/estela?style=flat-square" alt="GPL-3.0-only"></a>
</p>

_Estela_ is Spanish for the wake a ship leaves behind.

Estela brings the Agent sessions on this machine into one local interface. Each session has a timeline, an event ledger, and token counts; each request has the context the model received.

The core capability is request-level context reconstruction. For any request, Estela rebuilds the context the model received — system prompt, tools, messages, and the events a compaction removed. Slots the log never recorded are marked `unavailable`; nothing is estimated.

## Features

- **Session browser.** One place for every session found on this machine, grouped by day and newest first. Each row carries the agent, title, project, turns, requests, tokens, duration, last activity, and flags for compaction, subagents, and failed tool calls. Filters by agent, project, and flag; search across titles and your own prompts; a preview of the selected session's context-over-time shape.
- **Session workspace.** Session metrics, a request timeline, an event ledger, and an event inspector. The timeline shows one bar per request (height is input tokens), one lane per subagent, and markers for prompts, failed tool calls, and compactions; the ledger groups events by turn or by agent, and the inspector shows the selected event.
- **Model saw.** The context reconstruction for the selected request: system prompt, tools, messages, and the events a compaction removed; slots the log never recorded are marked `unavailable`.
- **Report.** A redacted static export of one session's workspace: one `index.html` that opens from disk with no server.
- **MCP for coding agents.** `estela mcp` gives an agent read-only tools over stdio to find an earlier session, read its turns, requests, and events, and reconstruct what the model saw at a failing request; a skill tells the agent how.

Static mockups of both screens are in [`docs/design/`](docs/design/README.md).

## Quick start

Node.js 24 or later:

```sh
npx @rivus/estela
```

It starts a server on `localhost:7392`, opens the browser, and indexes the sessions of the supported agents. `--no-open` prints the URL instead; `--port 0` picks a free port.

To build from source, use Node.js `^26.13.1` (26.13.1 or later within 26.x); the built CLI runs on Node.js 24 or later:

```sh
pnpm install
pnpm build
node apps/cli/dist/bin.mjs
```

## Commands

```sh
npx @rivus/estela [path] [--port <n>] [--host <host>] [--no-open] [--no-auth] [--pick] [--no-index]
npx @rivus/estela build [path] [--out-dir <dir>]
npx @rivus/estela mcp [path]
npx @rivus/estela export-atif [path] [--out <file>]
npx @rivus/estela export-otlp [path] [--out <file>]
```

| Command | What it does |
|---|---|
| `estela` | Session browser for this machine. |
| `estela <path>` | Loads that session before the server listens (exit 1 with the reason if no agent adapter accepts it), then opens its workspace. |
| `estela --pick` | Searchable session list in the terminal; Enter opens the chosen session. Needs an interactive terminal. |
| `estela build <path> --out-dir <dir>` | Writes the report of one session to `<dir>/index.html` (default `dist-static`). |
| `estela mcp` | MCP server over stdio with tools over every session on this machine (see [MCP for coding agents](#mcp-for-coding-agents)). Only protocol messages go to stdout. |
| `estela mcp <path>` | The same server over that one session: the session tools without list and search. |
| `estela export-atif <path> --out <file>` | Writes the session as one [ATIF v1.8](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md) trajectory (default `estela-<session>.atif.json`) for Harbor datasets and evaluation. |
| `estela export-otlp <path> --out <file>` | Writes the session as one OTLP/JSON `ExportTraceServiceRequest` (default `estela-<session>.otlp.json`) whose spans carry the OpenTelemetry GenAI attributes of `gen-ai-dev/1.42.0-dev`, for Langfuse, LangSmith, and Phoenix. |

| Flag | Meaning |
|---|---|
| `--port <n>` | Port (default 7392; `0` picks a free one). |
| `--host <host>` | Bind address (default `localhost`). |
| `--no-open` | Print the URL; do not open a browser. |
| `--no-auth` | Turn off DevFrame's one-time-code gate. By default the opened URL carries the code. |
| `--pick` | Pick the session in the terminal. |
| `--no-index` | Do not read or write the session index; summaries are computed again on each launch and not stored. |
| `--mcp` | Also serve the MCP tools over HTTP at `/__estela/__mcp`. Off by default: the one-time code does not gate this route, so any process on this machine can call it. |

`ESTELA_PATH` is the default session path. `build` and the export commands fall back to a bundled demo trace when no path is given; `mcp` serves every session. A session in a shared database is named with its id: `estela ~/.local/share/opencode/opencode.db#<sessionId>`. When output is not a terminal, or `NO_COLOR` is set, the CLI prints plain lines with no escape sequences. `estela --help` and `estela <command> --help` list each command's arguments and flags; an unknown flag exits 1 before any session is read.

## Taking a session elsewhere

`export-atif` and `export-otlp` project the canonical trace onto two interchange formats. Each step or span names the canonical events it came from (`extra.estela.eventIds` in ATIF), so an export can be traced back to the workspace.

```sh
# Harbor datasets and evaluation (ATIF v1.8)
npx @rivus/estela export-atif <path> --out trajectory.json
python -m harbor.utils.trajectory_validator trajectory.json   # Harbor's validator

# Langfuse (OTLP/JSON goes up as is)
curl -H "Content-Type: application/json" -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  --data-binary @estela-<session>.otlp.json https://cloud.langfuse.com/api/public/otel/v1/traces

# LangSmith or Phoenix (OTLP/protobuf receivers: convert once, then post)
uv run --with opentelemetry-proto python -c \
  "from google.protobuf.json_format import Parse; from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest as R; import sys; sys.stdout.buffer.write(Parse(open(sys.argv[1],'rb').read(), R()).SerializeToString())" \
  estela-<session>.otlp.json > session.otlp.pb
curl -H "Content-Type: application/x-protobuf" --data-binary @session.otlp.pb http://localhost:6006/v1/traces
```

Exports are redacted like the server (`~` for the home directory, known credential patterns replaced); `ESTELA_REDACT=0` writes the unredacted bytes. Events a compaction removed produce no ATIF step; steps kept across a compaction are marked `is_copied_context`, and the compaction is a system step with `extra.context_management`.

## MCP for coding agents

`estela mcp` serves seven read-only tools over stdio: `estela_list_sessions` and `estela_search_sessions` (filter by agent, project, directory, time, compactions, failed tools), `estela_session_summary`, `estela_list_turns`, `estela_list_requests`, `estela_get_event`, and `estela_reconstruct`. Each tool has a JSON input schema with named properties. Each result is JSON, at most 40,000 characters, says when it was cut and how to read more, and is redacted. The tools, inputs, and results are specified in [Spec 0009](docs/specs/0009-mcp-tools.md).

Add the server to an agent (until `@rivus/estela` is on npm, use `node <repo>/apps/cli/dist/bin.mjs mcp` in place of `npx -y @rivus/estela mcp`):

```sh
# Claude Code
claude mcp add --scope user estela -- npx -y @rivus/estela mcp

# Codex
codex mcp add estela -- npx -y @rivus/estela mcp
```

Codex can also read it from `~/.codex/config.toml`:

```toml
[mcp_servers.estela]
command = "npx"
args = ["-y", "@rivus/estela", "mcp"]
```

Gemini CLI's `~/.gemini/settings.json` (or a project's `.gemini/settings.json`):

```json
{ "mcpServers": { "estela": { "command": "npx", "args": ["-y", "@rivus/estela", "mcp"] } } }
```

The skill [`skills/estela/SKILL.md`](skills/estela/SKILL.md) tells an agent how to debug an earlier session with these tools. It is not in the npm package; copy the `skills/estela` folder from this repository:

- Claude Code: to `~/.claude/skills/estela/` (every project) or `.claude/skills/estela/` (one project).
- Codex: to `~/.codex/skills/estela/` (Codex CLI 0.167 reads skills there); on a version without skills, paste the body of `SKILL.md` into `AGENTS.md`.
- Gemini CLI: paste the body of `SKILL.md` into `GEMINI.md`.

## Supported agents

| Agent | Where sessions are found |
|---|---|
| Claude Code | `~/.claude/projects/` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`, `~/.codex/archived_sessions/**/rollout-*.jsonl` |
| DeepSeek Harness | `~/.dsh/sessions/<cwd>/<session-id>/session.v4.jsonl.zstd` |
| Gemini CLI | `~/.gemini/tmp/**/chats/*.jsonl`, and a legacy `*.json` chat without its `.jsonl` sibling |
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Pi | `~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl` |

- The agents' home overrides apply and replace the default home: `CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex, `DSH_HOME` for DeepSeek Harness, `GEMINI_CLI_HOME` for Gemini CLI, `GROK_HOME` for Grok, `XDG_DATA_HOME` for OpenCode, and `PI_CODING_AGENT_DIR` for Pi. With `CLAUDE_CONFIG_DIR` set, sessions only under `~/.claude` are not listed.
- An agent whose folder does not exist shows 0 sessions and the path it checked. A file the adapter cannot parse is listed as "could not read" with the file, line, and reason. A line inside a session that is not JSON is skipped and does not fail the session.
- Grok records token usage only per turn, so a Grok session has one request per turn, not one per model call.

## Privacy

- Everything runs on this machine. The server binds `localhost`, and nothing is sent anywhere.
- Session files are read, never written.
- The session index lives at `$XDG_CACHE_HOME/rivus-estela/index.sqlite` (default `~/.cache/rivus-estela/`), with mode 0600. It holds titles, paths, numbers, and the first 200 prompts the user typed (500 characters each) for search — not the text the agent injected or recorded itself. Deleting it is safe; it is rebuilt from the logs. `--no-index` runs without it.
- URLs carry opaque trace ids, never paths.
- The local server replaces the home directory with `~` and known credential patterns with placeholders; `ESTELA_REDACT=0` turns that off for the local server only.
- MCP tool results are always redacted the same way, whatever `ESTELA_REDACT` says. They still hold session text, which an agent must treat as data, not instructions.
- A report (`build`, or "Export report" in the workspace) is always redacted the same way, whatever `ESTELA_REDACT` says. **Session text and file contents remain in it, so read a report before you share it.** It holds the view of every event and the original records of the first 2,000 events or 20 MB, whichever is smaller; its header says when it holds fewer.

## Development

The repository is a pnpm workspace. The UI is Solid, Tailwind v4, and shadcn-solid; build, lint, format, and test run through Vite+ (`vp`).

- [Architecture](docs/architecture/overview.md): current behavior and the system shape.
- [Visual design](docs/design/README.md): screens, tokens, and the logo.
- [Development setup](docs/development/setup.md): local commands, the tarball, and the smoke and browser suites.
- [Contributing](CONTRIBUTING.md): workflow, change gates, and release intent.
- [Security](SECURITY.md): how to report a vulnerability.

```sh
pnpm install
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

## License

GPL-3.0-only. See [LICENSE](LICENSE).
