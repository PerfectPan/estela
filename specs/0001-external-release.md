# Spec 0001: Use agent-trace without cloning the repository

## Status

Draft

Paired Plan: [`docs/plans/0001-external-release.md`](../docs/plans/0001-external-release.md)

## Problem And Scope

The CLI already declares three entry points (`agent-trace --help` lists the dev server, `build`, and `mcp`): a local viewer, a redacted static report, and an MCP server that other agents call for `reconstruct`. Today a person who is not the author has to clone the repository, install Rush, and set an environment variable to open one session. The static report command exits 1. The MCP command exits 1. The CLI does not start on Node.js 20 even though `rush.json` allows it.

In scope:

- One installable CLI that runs the three entry points on Node.js 22.18 or later.
- The session path as a command argument.
- A static report that does not carry the sharer's home directory.
- Clear errors for hosts that are not implemented.

Out of scope:

- dsh and Claude Code parsers.
- Timeline overview, list virtualization, request dots, turn collapse, composer.
- Live follow of a running session, accounts, upload, hosted service.
- A stable library API for `@agent-trace/schema` or `@agent-trace/kernel`.

## Behavioral Requirements

- The CLI must start with `npx <package> [path]` on Node.js 22.18 or later, without a clone of this repository.
- With no path and no `AGENT_TRACE_PATH`, the CLI must open the bundled demo trace.
- A path argument must take precedence over `AGENT_TRACE_PATH`.
- The CLI must load the trace once before it starts serving. A load failure must exit non-zero and print the error. It must not start a server that fails on the first request.
- `build [path]` must write a static report and exit 0 for every input that the viewer can open.
- The static report must always be redacted. `AGENT_TRACE_REDACT=0` affects only the local viewer.
- Redaction must replace the sharer's home directory with `~` in every string of the trace, and must replace the loaded path with its base name.
- `mcp [path]` must expose `reconstruct` as a tool over stdio.
- A dsh file or a Claude Code project path must fail with the same unsupported-input error as any unknown file.
- On Node.js older than 22.18, the CLI must refuse to install or must exit with a message that names the required version.

## Domain Invariants

- Canonical storage stays ordered `events[]` plus `original`. Redaction returns a copy and never writes to the input file.
- Missing data stays `unavailable`. No entry point invents events.
- `getTrace` stays one snapshot. No paging RPC.

## Acceptance Examples

### S1: Demo from an empty directory

- Given Node.js 22.18 and an empty directory
- When the user runs `npx <package> --no-open`
- Then the server prints a localhost URL, and `GET /__agent-trace/` returns 200 with the demo trace

### S2: Own session by argument

- Given a Grok session directory, a Codex `rollout-*.jsonl`, or `opencode.db#<session id>`
- When the user runs `npx <package> <that path>`
- Then the viewer shows that session, and the startup line prints the host and the event count

### S3: Bad path fails at startup

- Given a path that does not exist
- When the user runs `npx <package> <that path>`
- Then the process exits 1 before listening, and stderr names the path

### S4: Unimplemented host

- Given a file named `session.jsonl` that is not a canonical trace, or a path under `.claude/projects`
- When the user runs the CLI on it
- Then the process exits 1 with `UnsupportedTraceError`

### S5: Static report

- Given any input from S1 or S2
- When the user runs `npx <package> build <path> --out-dir report`
- Then the command exits 0, `report/index.html` exists, and no file under `report/` contains the value of `os.homedir()`

### S6: Static report ignores the redaction switch

- Given `AGENT_TRACE_REDACT=0`
- When the user runs `build`
- Then the output is still redacted, and stderr states that the switch was ignored

### S7: MCP reconstruct

- Given the demo trace
- When an MCP client sends `initialize`, then `tools/list`, then calls the reconstruct tool with the last event id
- Then `tools/list` includes the reconstruct tool, and the call returns `visibleIds`, `unavailable`, and `completeness`

### S8: Old Node.js

- Given Node.js 20
- When the user runs `npx <package>`
- Then the user sees a message that names Node.js 22.18, not a module-loader stack trace

## Compatibility And Constraints

- Public API: the CLI commands and flags above. Package exports are not public API in this release.
- Persisted data: none. `agent-trace/v0` files keep loading unchanged.
- Configuration: `AGENT_TRACE_PATH`, `AGENT_TRACE_SESSION`, and `AGENT_TRACE_REDACT` keep their current meaning, except S6.
- Operational bounds: local tool. Default bind is `localhost`.

## Acceptance Evidence

- S1, S3, S4, S5, S6, S7: packed-tarball smoke test in CI on Node.js 22.18 and 24 (Plan section 5).
- S2: one local run per host, recorded in the delivery PR as command plus event count. Session files are not committed.
- S8: CI step that runs the installed CLI on Node.js 20 and checks the message.
