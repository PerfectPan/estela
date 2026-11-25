# Troubleshooting

Every failure Estela expects prints the cause and one line on how to fix it, and exits with status 1. `estela --help` lists the options.

## "estela requires Node.js 24 or later."

The CLI checks the Node.js version before it loads anything else. Run `node --version`, and install Node.js 24 or later (for example with your version manager), then run `estela` again.

## The port is in use

Without `--port`, Estela uses 7392 or, when another program holds it, the next free port, and prints the URL it chose. With `--port <n>` it uses exactly that port and fails when the port is taken (`Port <n> is already in use.`). Stop the process using port `<n>`, or pass `--port` with a free port (or omit `--port`).

## A session says "Could not read"

A session file the reader cannot parse is still listed, marked "Could not read", and opening it shows the agent, file, line, and reason. Common causes:

- **The agent changed its log format.** Readers reject a log generation they do not know instead of showing part of it. Once `@rivus/agent-kit` ships an updated reader, Estela publishes a patch release. Update Estela (`npx @rivus/estela@latest`, or `npm install -g @rivus/estela`); if the newest version still cannot read it, [open an issue](https://github.com/PerfectPan/estela/issues/new/choose) with the agent's name and version and the reason line (not the session content).
- **The file is not a session**, or was cut off while the agent was writing it.

A single line that is not JSON does not cause this: it is skipped and the rest of the session loads.

`estela <path>` with a file no reader accepts exits with `Could not load <path>: <reason>`. Pass a session file, `path#sessionId`, or a canonical Estela JSON trace.

## An agent shows 0 sessions

The rail shows the folder Estela checked. If your sessions are elsewhere, set the agent's home override in the environment Estela runs in (`ANTIGRAVITY_GEMINI_DIR`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `DSH_HOME`, `DIMCODE_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`, `KIMI_CODE_HOME`, `XDG_DATA_HOME`, `PI_CODING_AGENT_DIR`, `QODER_CONFIG_DIR`, `ZCODE_STORAGE_DIR`; see [Supported agents](supported-agents.md)), or open the session by path.

## "Session folder unreadable"

Estela could not read one of an agent's session folders, for example a `~/.claude` your user cannot enter. Estela starts and lists the other agents. That agent's list shows one "Could not read" row with the reason, and the terminal names the folder and the reason (the folder as `~`). Every agent reports it when the folder above the session folder cannot be entered. When the session folder itself cannot be read, how an agent reports it is up to its reader: OpenCode, ZCode, and DimCode show the "Could not read" row but print no warning, and Kimi Code and Antigravity CLI report nothing, so they show 0 sessions, the folder Estela checked, and no warning. For those five, check the folder's permissions yourself when it shows no sessions. Give your user read permission (r) on that folder and enter permission (x) on it and on the folders above it, or set the agent's home override (see above) to a folder you can read, then start again. `--no-index` does not help: Estela reads these folders to list sessions, with or without the index.

## Index problems

The [session index](privacy.md#the-session-index) is only a cache. If it cannot be opened (for example a read-only cache folder), Estela prints one warning and runs without it. If indexing fails at startup it exits with `Could not index sessions: <reason>` and suggests `--no-index`.

When the list looks wrong or stale, delete the cache and start again:

```sh
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/rivus-estela"
```

`--no-index` runs without it for one start.

## "Lost the connection to the Estela server"

The page lost its connection to the local server: the `estela` process stopped, or the computer slept. A loaded workspace stays readable. Start `estela` again and press Reload.

If you started Estela with an explicit `--host` such as `127.0.0.1` or `[::1]`, open the exact URL printed in the terminal rather than `http://localhost:<port>/` — browser WebSocket and SSE connections from a mismatched origin host are rejected with HTTP 403. With `--host 0.0.0.0` the terminal prints `http://127.0.0.1:<port>/`, and with `--host ::` it prints `http://[::1]:<port>/`: `localhost` may resolve to the other address family first and reach another program on that port.

## `--pick` fails

`--pick` needs an interactive terminal and cannot be combined with a session path. "No sessions to pick." means no supported agent has sessions in the checked folders.

## A command name used as a value

On the main command, a bare word that names a command (`build`, `mcp`, `export-atif`, `export-otlp`) is read as that command. Write a host named like a command as `--host=build`, and a session file named like one as `./build`.

## dsh says the plugin is incompatible

`@rivus/dsh-estela` declares the DeepSeek Harness versions it supports in `engines.dsh` (`>=0.2.2-rc.5 <0.3.0-0`; see [DeepSeek Harness plugin](dsh-plugin.md#version-range)).

- **During install:** if your `dsh` version is outside `engines.dsh`, `dsh` refuses before installing anything, exits with status 1, and prints which requirement was not met.
- **After upgrading or downgrading `dsh`:** if the plugin is already in the `web` profile and `dsh` is now outside `engines.dsh`, `dsh` starts without the plugin, prints one line on stderr explaining why it disabled the plugin, and `dsh web` shows no Estela tab.

Use a `dsh` version inside `engines.dsh`, or update `@rivus/dsh-estela` once a release supports your `dsh` version. If you want to accept the risk explicitly for one exact plugin version on one exact `dsh` version, run:

```sh
dsh plugin --profile web allow-version @rivus/dsh-estela@<plugin-version> --dsh-version <current-dsh-version> --accept-risk
```

## Upgrading from `@rivus/agent-trace`

Estela was published as `@rivus/agent-trace` up to 0.1.0. The new version does not read the old names: rename `AGENT_TRACE_PATH` and `AGENT_TRACE_REDACT` to `ESTELA_PATH` and `ESTELA_REDACT`. The index moved to `rivus-estela`; the old `rivus-agent-trace` cache folder can be deleted. Theme and language choices reset once.
