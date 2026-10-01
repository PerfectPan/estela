# Spec 0001: agent-trace DevTools

## Status

Implemented

Paired Plan: [`docs/plans/0001-external-release.md`](../plans/0001-external-release.md)

Visual design: [`docs/design/`](../design/README.md)

## Problem And Scope

A developer who uses coding agents cannot easily see what an agent did in a session, or what the model was shown at a given request. The logs exist on the developer's machine, but each host writes a different format, and a raw JSONL file hides request boundaries, context size, compactions, and subagents.

agent-trace is a local DevTools. One command opens it in the browser. The developer picks a session from any supported host and debugs it on one screen: a timeline of requests and context size, a ledger of events grouped by turn, and an inspector that shows what the model saw at the selected request.

In scope:

- `npx @rivus/agent-trace` opens the DevTools in the default browser.
- A session browser that lists sessions found on the machine for the supported hosts.
- A session workspace: header numbers, timeline, ledger, inspector.
- Supported hosts in this release: Claude Code, Codex, Grok. Each is connected through one host protocol.
- A redacted static report of one session.
- Dark and light themes.
- English and Simplified Chinese UI.
- A styled terminal experience: startup, progress, the local URL, errors, and a terminal session picker.
- An MCP server that exposes `reconstruct` to other agents.

Out of scope:

- OpenCode and dsh in the session browser. They follow as later hosts on the same protocol.
- ATIF or OTLP export.
- Live follow of a session that is still running.
- Editing, replaying, or re-running a session.
- Accounts, upload, or a hosted service.
- A stable library API for the internal packages.
- Publishing to the npm registry. This release is verified from the packed tarball.

## Behavioral Requirements

### Launch

- `npx @rivus/agent-trace` must start a server on `localhost` and open the session browser in the default browser. `--no-open` must skip opening the browser and print the URL.
- `npx @rivus/agent-trace <path>` must open the session workspace for that session directly.
- A path that does not exist or that no supported host accepts must exit 1 before the server listens, with a message that names the path.
- On Node.js older than 22.18, the command must exit with a message that names the required version.

### Terminal output

- In a terminal, the CLI must show a startup header with name and version, progress while it indexes sessions and while it loads a session, the local URL in a highlighted block as a clickable link where the terminal supports it, and errors with the cause and one line on how to fix it.
- When output is not a terminal, or `NO_COLOR` is set, the CLI must print plain lines: no color codes, no cursor control, no animation.
- `npx @rivus/agent-trace --pick` must open a searchable session list in the terminal and open the chosen session in the browser. Without an interactive terminal it must exit 1 with a message saying `--pick` needs one.
- `mcp` must write nothing but protocol messages to stdout. Its own messages go to stderr.

### Session browser

- The browser must list sessions from each supported host's default location on this machine, newest activity first, grouped by day.
- Rows must appear within 2 seconds of opening, even when the hosts hold thousands of sessions and several gigabytes of logs. Numbers that need a full read of a session file fill in as they are computed, and they are cached between runs so the next launch shows them at once.
- Each row must show the host, title, project directory, turns, requests, tokens, duration, last activity, and flags for compaction, subagents, and failed tool calls. A value the host log does not record must show as "—", not as zero.
- A host whose default location does not exist must appear with a count of 0 and the path that was checked. It is not an error.
- A session file that the adapter cannot parse must still be listed, marked "could not read", with the reason available on hover. It must not be silently hidden.
- The list must be filterable by host, project, and the three flags, and searchable by title and by the text of every user prompt, in English and Chinese.
- Selecting a row must show a preview: the context-over-time shape, the headline numbers, and the first prompt.

### Session workspace

- The header must show host, working directory, start time, title, duration, turns, requests, tokens in and out, compactions, subagents, and failed tool calls.
- The timeline must draw one bar per model request whose height is that request's input tokens, one lane per subagent, a marker at each user prompt, a marker at each failed tool call, and a dashed rule at each compaction labeled with the token count before and after when the host records it.
- Dragging a range on the timeline must filter the ledger to that range. The range handles must also be focusable and movable with the arrow keys.
- The ledger must group events by turn. A turn must collapse and expand. Hook events must fold into one row per run of hooks. A toggle must dim the events that the model no longer sees after a compaction.
- The ledger must stay responsive for sessions of at least 10,000 events.
- A session file of at least 350 MB must open. The workspace must show loading progress, and the browser must not receive the whole file: long text is shortened in the ledger with a visible marker, and the full text and the original record load when the event is selected.
- Selecting a request must open the inspector. Its "Model saw" tab must show the context composition at that request (system prompt, tools, summary, messages, current turn) with token counts where known, and the events that compaction removed before it. A slot the host does not record must be labeled "unavailable". It must not be estimated.
- Selecting any event must show its normalized fields and, in "Raw", the host's original record.

### Report

- "Export report" in the workspace, and `npx @rivus/agent-trace build <path> --out-dir <dir>`, must write a static report of one session that opens without a server.
- The report must always be redacted: the sharer's home directory becomes `~`, and the known token patterns are replaced. `AGENT_TRACE_REDACT=0` must not affect the report.

### MCP

- `npx @rivus/agent-trace mcp <path>` must serve `reconstruct` for that session as an MCP tool over stdio.

### Theme

- The UI must follow the system color scheme and offer a manual dark and light switch that persists in the browser.

### Language

- The UI must be available in English and Simplified Chinese.
- On first load the UI must use Simplified Chinese when the browser's preferred language is Chinese, and English otherwise. A manual language switch must persist in the browser.
- Dates, times, durations, and numbers must be formatted for the selected language. Token counts keep the `k` and `M` abbreviations in both languages.
- Session content must be shown as recorded and never translated: prompts, replies, tool arguments and output, file paths, commands, model names, and the original record.
- The report must open in the language selected when it was exported and keep the language switch.
- CLI and MCP output stay in English in this release.

## Domain Invariants

- The canonical trace is ordered events, and each event can always return its original host record. Turns, requests, lanes, and statistics are projections of it.
- Missing data is `unavailable`. No screen invents a value, a boundary, or an event.
- Every host record is either represented by an event or counted as skipped with a reason. Nothing is dropped silently.
- Loading the same file twice gives the same event ids.
- Session files are read, never written.

## Acceptance Examples

### S1: Open the DevTools

- Given Node.js 22.18 and Claude Code, Codex, and Grok sessions in their default locations
- When the user runs `npx @rivus/agent-trace`
- Then the browser opens the session browser, and it lists sessions from all three hosts with per-host counts

### S2: Open one session directly

- Given the path of a Claude Code session file
- When the user runs `npx @rivus/agent-trace <path>`
- Then the browser opens that session's workspace

### S3: Host not installed

- Given no `~/.codex` directory
- When the session browser loads
- Then Codex shows 0 sessions and the checked path, and the other hosts load normally

### S4: Unreadable session

- Given a session file whose records use an unknown format generation
- When the session browser loads
- Then the row is listed as "could not read", and opening it shows the host, the file, and the first unreadable record's line number

### S5: Compaction in the timeline

- Given a Claude Code session with one automatic compaction
- When the user opens it
- Then the timeline shows request bars rising, a dashed rule labeled with the pre and post token counts, and lower bars after it

### S6: Brush filters the ledger

- Given an open session
- When the user drags a range on the timeline
- Then the ledger shows only events in that range, and the header of the timeline states the range and the event count

### S7: Model saw

- Given the first request after a compaction in a Claude Code session
- When the user selects it and opens "Model saw"
- Then the composition shows summary, messages, and current turn with token counts where the host recorded them, the system prompt and tools slots are "unavailable" (Claude Code records neither), and the list of events removed by the compaction is shown

### S8: Large session

- Given a session of 10,000 events
- When the user scrolls the ledger from top to bottom
- Then scrolling stays smooth and the page holds a bounded number of rendered rows

### S9: Report

- Given an open session
- When the user exports a report and opens `index.html` from disk
- Then the workspace renders without a server, and no file in the report contains the home directory

### S10: MCP reconstruct

- Given a session path
- When an MCP client lists tools and calls reconstruct with an event id
- Then the result lists the visible event ids, the unavailable slots, and the completeness

### S11: Theme

- Given the system is set to light mode
- When the user opens the DevTools, then switches to dark and reloads
- Then the first load is light, and after the reload it is dark

### S12: Very large session

- Given a Codex session file of 350 MB
- When the user opens it
- Then the workspace renders after a progress indicator, long tool outputs show a "shortened" marker, and selecting one loads its full text and original record

### S13: Old Node.js

- Given Node.js 20
- When the user runs `npx @rivus/agent-trace`
- Then the user sees a message that names Node.js 22.18, not a module-loader stack trace

### S14: Language

- Given a browser whose preferred language is `zh-CN`
- When the user opens the DevTools, then switches to English and reloads
- Then the first load shows Chinese labels and Chinese date formats, session content is unchanged, and after the reload the UI is English

### S15: Plain output when piped

- Given `NO_COLOR` unset and output piped to a file
- When the user runs `npx @rivus/agent-trace build <path> --out-dir report > log.txt`
- Then `log.txt` contains readable progress and result lines and no escape sequences

### S16: Terminal picker

- Given an interactive terminal and sessions from three hosts
- When the user runs `npx @rivus/agent-trace --pick`, types part of a title, and presses Enter
- Then the browser opens the workspace for the chosen session

## Compatibility And Constraints

- Public interface: the CLI commands and flags above. The canonical trace file format and package exports are not stable yet and change without a compatibility layer.
- Persisted data: the theme and language choices in browser storage, and a session index in the user cache directory (`$XDG_CACHE_HOME/rivus-agent-trace/`, default `~/.cache/rivus-agent-trace/`). Deleting the index is always safe; it is rebuilt from the logs.
- Configuration: `AGENT_TRACE_PATH` keeps working as the default session path. `AGENT_TRACE_REDACT=0` affects only the local server.
- Operational bounds: local tool, default bind `localhost`. The session browser reads only what it needs to build each row.

## Acceptance Evidence

- S1, S3, S4, S5, S6, S7, S9, S11, S14: browser end-to-end tests against synthetic fixture homes, run in CI on the packed tarball.
- S2, S10, S13, S15: CLI smoke tests on the packed tarball.
- S16: a pseudo-terminal test (`node-pty` in the test harness only) on the packed tarball.
- S8: a generated 10,000-event trace, with the rendered row count asserted.
- S12: a generated 350 MB Codex-format fixture built at test time (not committed), with the payload size sent to the browser asserted.
- Real sessions: one local run per host, recorded in the delivery PR as host, command, event count, and load time. Session files are not committed.
