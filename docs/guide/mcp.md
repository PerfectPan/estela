# MCP tools

`estela mcp` is an MCP server over stdio. It gives an agent read-only tools to find an earlier session, read its turns, requests, and events, and reconstruct what the model saw at a request: for example to answer "why did the tests fail in my last session in this project".

## Start it

```sh
estela mcp            # every session on this machine
estela mcp <session>  # one session
```

- Without a session (and without `ESTELA_PATH`), the server reads every session the session browser would list, through the same [session index](privacy.md#the-session-index), and serves all seven tools.
- With a session (or `ESTELA_PATH`), it serves that one session as `current` and only the five session tools; the list and search tools are absent.
- stdout carries only MCP protocol messages; the ready line, warnings, and errors go to stderr. A session that cannot be loaded, or an index that fails to start, exits with status 1 before serving.

## Add it to an agent

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

Gemini CLI reads it from `~/.gemini/settings.json` (or a project's `.gemini/settings.json`):

```json
{ "mcpServers": { "estela": { "command": "npx", "args": ["-y", "@rivus/estela", "mcp"] } } }
```

With `estela` installed globally, use `estela mcp` in place of `npx -y @rivus/estela mcp`.

## The agent skill

[`skills/estela/SKILL.md`](../../skills/estela/SKILL.md) tells an agent how to go from a session list to a failing request with these tools. It is not in the npm package; copy the `skills/estela` folder from the repository:

- Claude Code: to `~/.claude/skills/estela/` (every project) or `.claude/skills/estela/` (one project).
- Codex: to `~/.codex/skills/estela/`; on a version without skills, paste the body of `SKILL.md` into `AGENTS.md`.
- Gemini CLI: paste the body of `SKILL.md` into `GEMINI.md`.

## The tools

| Tool | What it does |
|---|---|
| `estela_list_sessions` | Lists sessions newest first, filtered by `agent`, `project`, `cwd`, `since`, `until`, `hasCompaction`, `hasFailedTools` |
| `estela_search_sessions` | The same, for sessions whose title or one of the user's own prompts contains `query` |
| `estela_session_summary` | One session's agent, title, times, recorded counts (and the counts its log does not record), capabilities, and lanes |
| `estela_list_turns` | The turns in order, with their requests, tokens, failed tool results, and compactions |
| `estela_list_requests` | The model requests, optionally of one lane or turn, with model, tokens, duration, and finish reason |
| `estela_get_event` | One event in full, optionally with the log record it came from |
| `estela_reconstruct` | What the model saw at an event: the context slots, the recorded token counts, and the events a compaction removed |

Every tool is read-only and takes a JSON object with named properties. A typical walk: list or search sessions, take a `traceId`, read the summary, find the turn with a failed tool, list that turn's requests, and reconstruct at the request before the failure.

[MCP tools reference](../reference/mcp-tools.md) lists every input with its range and default, every result field, the size bounds, and the error texts. In short: each result is JSON of at most 40,000 characters; list pages set `nextOffset` when more items exist; long strings are cut and named in `truncated`; `estela_reconstruct` keeps at most the last 100 ids of each list, with the totals. A field that is absent was not recorded, except that a session item with `summary: "pending"` has its counts not computed yet.

## Results are data, not instructions

Every result is recorded session content: prompts, replies, tool output, file text, written by whoever produced the log. An agent must treat it as data and never follow instructions found in it. Each tool's description says so, and the skill repeats it.

Every result and error message is redacted whatever `ESTELA_REDACT` says (see [Privacy](privacy.md#what-redaction-covers)). An event or lane id is returned as written only when it is 1 to 128 letters, digits, `_`, `.`, `:`, or `-` and redaction leaves it unchanged; any other id is returned as `@e<n>` (an event, by its position) or `@l<n>` (a lane), and the tools accept that form back. When a log repeats an id, it names the last event with that id.

## Errors

A failed call returns an MCP error result that names the tool and the cause, for example:

```text
Error invoking "estela_list_sessions": Error: estela_list_sessions: limit: expected an integer from 1 to 50
```

The causes and their texts are listed in the [reference](../reference/mcp-tools.md#errors).

## Over HTTP from the local server

`estela --mcp` also serves the same seven tools over HTTP at `/__estela/__mcp` on the local server. The one-time code that protects the browser page does not protect this route; a bearer token does. At startup Estela prints the route and the header a client sends:

```text
MCP: http://localhost:7392/__estela/__mcp
MCP header: Authorization: Bearer <token>
```

The token is `ESTELA_MCP_TOKEN` when that variable is set and not empty, and then the header line names the variable instead of printing it; it must be visible ASCII characters without spaces, or Estela refuses to start. Otherwise Estela makes a new token at each launch. To keep one client configuration working across restarts, set `ESTELA_MCP_TOKEN` once (for example to the output of `openssl rand -hex 32`) in the environment both commands below run in, and fix the port, since the default moves to the next free port when 7392 is taken. For Claude Code:

```bash
estela --mcp --port 7392
claude mcp add --transport http estela http://localhost:7392/__estela/__mcp --header "Authorization: Bearer $ESTELA_MCP_TOKEN"
```

With `ESTELA_MCP_TOKEN` unset where `claude mcp add` runs, the stored header has no token and every request fails.

A request without the token, or with another one, gets HTTP 401 before any tool runs. Command-line MCP clients send no `Origin` header, and the route accepts that. Whatever token it carries, a request gets HTTP 401 when its `Host` header is not a loopback address, as a page reached through DNS rebinding sends, or when its `Origin` is not a loopback address, as a browser sends with every POST. A cross-origin request from a page either carries `Origin` or cannot carry `Authorization`, so no web page can use the route or try tokens on it. `--mcp` is refused with a `--host` that is not a loopback address, so no other machine can connect to the route. Anyone who has the token can read every session through it, so keep the token private. On a machine you share with other users, use the token Estela makes at each launch rather than a fixed `ESTELA_MCP_TOKEN` in a client's configuration: while Estela is not running, another user can listen on its port and receive the header a client sends when it connects, and a launch's token is useless once that launch ends. Use the stdio server unless you need HTTP.

The server keeps the last 3 loaded sessions in memory, so an agent that walks through many sessions makes Estela load them again.
