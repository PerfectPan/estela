# Getting started

## Run it

Estela needs Node.js 24 or later and runs on macOS, Linux, and Windows. Run it without installing:

```sh
npx @rivus/estela
```

Or install the `estela` command once:

```sh
npm install -g @rivus/estela
estela
```

The command reads the session folders of every supported agent (an agent with none shows the folders it checked), starts a local server, and opens your browser. The server listens on `localhost:7392`, or on the next free port when 7392 is taken. The opened URL carries a one-time code that lets that browser in; another browser has to enter the code the terminal prints. When the output is not a terminal, the progress is plain lines like these:

```text
estela 0.2.0
Claude Code: 12/12 files read
Codex: 0 files, checked ~/.codex/sessions, ~/.codex/archived_sessions
...
Ready: http://localhost:7392/__estela/#/
```

Stop the server with Ctrl-C. Useful options:

| Option | Effect |
|---|---|
| `--no-open` | Print the URL instead of opening a browser |
| `--port <n>` | Listen on that port; `--port 0` picks any free port |
| `--host <host>` | Bind another address than `localhost` (see [Privacy](privacy.md) before you do) |
| `--no-index` | Do not read or write the [session index](privacy.md#the-session-index) |

`estela --help` and `estela <command> --help` list every argument and option. The full list is in [Public interface](../reference/public-interface.md#command-line).

## The first screen: the session browser

Without a session argument, Estela opens the session browser. It lists every session it found for the [supported agents](supported-agents.md), newest activity first and grouped by day.

- The left rail lists each agent with its session count, and the folder it checked when it found none. Below it are the projects (the last folder of each session's working directory) and the "Show only" flags: has compaction, has subagents, has failed tools.
- Each row shows the agent, title, project, turns, requests, tokens, duration, and last activity, with marks for compaction, subagents, and failed tool calls.
- The search box matches session titles and the prompts you typed yourself. It does not search the agent's replies, tool output, or files.
- Selecting a row shows a preview: the session's numbers, its first prompt, and its context size over time. Opening it shows the [workspace](workspace.md).

The numbers fill in while Estela reads the sessions in the background, newest first; the list says how many it is still reading. On the next start they come from the [session index](privacy.md#the-session-index) at once.

A file Estela cannot read is still listed, marked "Could not read", with the file, line, and reason (see [Troubleshooting](troubleshooting.md#a-session-says-could-not-read)).

## Open one session

Give a session path to open its workspace directly:

```sh
estela ~/.claude/projects/my-app/0f8c2f1e-....jsonl
estela ~/.local/share/opencode/opencode.db#ses_123abc
```

The argument is a session file, a `path#sessionId` for a file or database that holds several sessions (OpenCode, DimCode, and ZCode always), or a canonical Estela JSON trace. Estela loads it before the server starts and exits with status 1 and the reason if no agent reader accepts it. `ESTELA_PATH` sets the same argument from the environment.

## Pick a session in the terminal

```sh
estela --pick
```

`--pick` shows a searchable list of sessions in the terminal. Type part of a title to filter it, and press Enter to open that session in the browser. It needs an interactive terminal and cannot be combined with a session path; either mistake exits with status 1.

## Next

- [Concepts](concepts.md) explains the words the workspace uses.
- [The workspace](workspace.md) explains each panel and number.
