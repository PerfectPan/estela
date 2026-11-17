# Supported agents

Estela reads the logs of seven agents. The readers live in [`@rivus/agent-kit`](https://www.npmjs.com/package/@rivus/agent-kit) 0.25.0, bundled into the CLI.

## Where sessions are found

| Agent | Default location | Home override |
|---|---|---|
| Claude Code | `~/.claude/projects/` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`, `~/.codex/archived_sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| DeepSeek Harness | `~/.dsh/sessions/<cwd>/<session-id>/session.v4.jsonl.zstd` | `DSH_HOME` |
| Gemini CLI | `~/.gemini/tmp/**/chats/*.jsonl`, and a legacy `*.json` chat without its `.jsonl` sibling | `GEMINI_CLI_HOME` |
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | `GROK_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db` | `XDG_DATA_HOME` |
| Pi | `~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl` | `PI_CODING_AGENT_DIR` |

A home override, when set in the environment Estela runs in, replaces the default home for that agent, the same way the agent itself uses it. With `CLAUDE_CONFIG_DIR` set, sessions that exist only under `~/.claude` are not listed.

Claude Code subagent files are shown inside their parent session. An OpenCode database holds many sessions; each one is opened as `opencode.db#<sessionId>`. Any session can also be opened by path, wherever the file is (see [Getting started](getting-started.md#open-one-session)).

An agent whose folder does not exist shows 0 sessions and the folder Estela checked. Agents not in this table are not read.

## What each agent records

What Estela can show depends on what the agent writes to its log. This table comes from the capabilities each reader declares and the conformance fixtures under `fixtures/sessions/<agent>/` that `packages/server/src/sessions/conformance.test.ts` runs. "Not recorded" means the agent's log does not hold that data, so the matching view shows `unavailable` or "—" for every session of that agent.

| Agent | System prompt | Tool definitions | Usage | Cache token classes | Subagents | Compaction | Durations | Hooks |
|---|---|---|---|---|---|---|---|---|
| Claude Code | from prompt snapshots (Claude Code 2.1.268 and later) | from prompt snapshots (2.1.268 and later) | per request | read, write (5-minute and 1-hour) | yes | yes, with tokens before and after | yes | yes |
| Codex | when the rollout records it (older rollouts do not) | not recorded | per request | read, write when recorded | yes | yes, without token counts | yes | not recorded |
| DeepSeek Harness | yes | yes | per request | read, write | not recorded | yes, with tokens | not recorded | not recorded |
| Gemini CLI | not recorded | not recorded | per request | read only | not recorded | yes, with tokens | not recorded | not recorded |
| Grok | when the session folder has the prompt file | when the session folder has the tools file | per turn (below) | read, write | yes | yes, with tokens | yes | yes |
| OpenCode | not recorded | not recorded | per request | read, write | not recorded | not recorded | not recorded | not recorded |
| Pi | not recorded | not recorded | per request | read, write | not recorded | yes, with tokens | not recorded | not recorded |

Every agent records requests, token usage, and the reasoning text the model produced. A request's input tokens include its cache reads and writes wherever the agent records those classes.

When a log does not record the system prompt or tool definitions, those slots of [Model saw](concepts.md#model-saw) are `unavailable` and [Compare](workspace.md#compare) does not compare them.

## Known limits

- **Grok records usage only per turn.** Each Grok request covers one whole turn (several model calls, subagents that finished within it included), so a Grok session has one request per turn, not one per model call. Grok also logs its own cost per turn; Estela shows the list price of the recorded tokens instead ([Cost](workspace.md#cost)).
- **Agent-logged cost is not shown.** OpenCode, Pi, and Grok log a cost of their own, and Codex logs a priority-tier multiplier. The readers do not pass these to the viewer yet, so the cost Estela shows can differ from what those agents logged.
- **New log formats are rejected, not guessed.** When an agent release changes its log format in a way the reader does not know, the session shows "Could not read" with the file, line, and reason instead of a partial session. Reading resumes after an Estela release with an updated reader (see [Troubleshooting](troubleshooting.md#a-session-says-could-not-read)).
- **One line can be skipped.** A line that is not JSON is skipped and counted, and the rest of the session loads.
