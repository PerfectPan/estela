# Troubleshooting

Every failure Estela expects prints the cause and one line on how to fix it, and exits with status 1. `estela --help` lists the options.

## "estela requires Node.js 24 or later."

The CLI checks the Node.js version before it loads anything else. Run `node --version`, and install Node.js 24 or later (for example with your version manager), then run `estela` again.

## The port is in use

Without `--port`, Estela uses 7392 or, when another program holds it, the next free port, and prints the URL it chose. With `--port <n>` it uses exactly that port and fails when the port is taken (`Port <n> is already in use.`). Stop the process using port `<n>`, or pass `--port` with a free port (or omit `--port`).

## A session says "Could not read"

A session file the reader cannot parse is still listed, marked "Could not read", and opening it shows the agent, file, line, and reason. Common causes:

- **The agent changed its log format.** Readers reject a log generation they do not know instead of showing part of it. Update Estela (`npx @rivus/estela@latest`, or `npm install -g @rivus/estela`); if the newest version still cannot read it, open an issue with the agent's name and version and the reason line (not the session content).
- **The file is not a session**, or was cut off while the agent was writing it.

A single line that is not JSON does not cause this: it is skipped and the rest of the session loads.

`estela <path>` with a file no reader accepts exits with `Could not load <path>: <reason>`. Pass a session file, `path#sessionId`, or a canonical Estela JSON trace.

## An agent shows 0 sessions

The rail shows the folder Estela checked. If your sessions are elsewhere, set the agent's home override in the environment Estela runs in (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `DSH_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`, `XDG_DATA_HOME`, `PI_CODING_AGENT_DIR`; see [Supported agents](supported-agents.md)), or open the session by path.

## Index problems

The [session index](privacy.md#the-session-index) is only a cache. If it cannot be opened (for example a read-only cache folder), Estela prints one warning and runs without it. If indexing fails at startup it exits with `Could not index sessions: <reason>` and suggests `--no-index`.

When the list looks wrong or stale, delete the cache and start again:

```sh
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/rivus-estela"
```

`--no-index` runs without it for one start.

## "Lost the connection to the Estela server"

The page lost its connection to the local server: the `estela` process stopped, or the computer slept. A loaded workspace stays readable. Start `estela` again and press Reload.

## `--pick` fails

`--pick` needs an interactive terminal and cannot be combined with a session path. "No sessions to pick." means no supported agent has sessions in the checked folders.

## A command name used as a value

On the main command, a bare word that names a command (`build`, `mcp`, `export-atif`, `export-otlp`) is read as that command. Write a host named like a command as `--host=build`, and a session file named like one as `./build`.

## Upgrading from `@rivus/agent-trace`

Estela was published as `@rivus/agent-trace` up to 0.1.0. The new version does not read the old names: rename `AGENT_TRACE_PATH` and `AGENT_TRACE_REDACT` to `ESTELA_PATH` and `ESTELA_REDACT`. The index moved to `rivus-estela`; the old `rivus-agent-trace` cache folder can be deleted. Theme and language choices reset once.
