# Supported agents

Estela reads the logs of twelve agents. The readers live in [`@rivus/agent-kit`](https://www.npmjs.com/package/@rivus/agent-kit) 0.26.0, bundled into the CLI.

## Where sessions are found

| Agent | Default location | Home override |
|---|---|---|
| Antigravity CLI | `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl`, or `transcript.jsonl` beside it when the full one is missing | `ANTIGRAVITY_GEMINI_DIR` |
| Claude Code | `~/.claude/projects/` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`, `~/.codex/archived_sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| DeepSeek Harness | `~/.dsh/sessions/<cwd>/<session-id>/session.v4.jsonl.zstd` | `DSH_HOME` |
| DimCode | `~/.dimcode/v2/dimcode.sqlite` | `DIMCODE_HOME` |
| Gemini CLI | `~/.gemini/tmp/**/chats/*.jsonl`, and a legacy `*.json` chat without its `.jsonl` sibling | `GEMINI_CLI_HOME` |
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | `GROK_HOME` |
| Kimi Code | `~/.kimi-code/sessions/<work-dir>/<session-id>/agents/main/wire.jsonl` | `KIMI_CODE_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db` | `XDG_DATA_HOME` |
| Pi | `~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl` | `PI_CODING_AGENT_DIR` |
| Qoder CLI | `~/.qoder/projects/<cwd>/<session-id>.jsonl` | `QODER_CONFIG_DIR` |
| ZCode | `~/.zcode/cli/db/db.sqlite` | `ZCODE_STORAGE_DIR` |

A home override, when set in the environment Estela runs in, replaces the default home for that agent, the same way the agent itself uses it. With `CLAUDE_CONFIG_DIR` set, sessions that exist only under `~/.claude` are not listed.

Claude Code and Qoder CLI subagent files are shown inside their parent session. An OpenCode, DimCode, or ZCode database holds many sessions; each one is opened as `<database>#<sessionId>`, such as `opencode.db#<sessionId>`. Any session can also be opened by path, wherever the file is (see [Getting started](getting-started.md#open-one-session)).

An agent whose folder does not exist shows 0 sessions and the folder Estela checked. Agents not in this table are not read.

## What each agent records

What Estela can show depends on what the agent writes to its log. This table comes from the capabilities each reader declares and the conformance fixtures under `fixtures/sessions/<agent>/` that `packages/server/src/sessions/conformance.test.ts` runs. "Not recorded" means the agent's log does not hold that data, and "not read" means the reader does not take it from the log, whether or not the agent records it; either way the matching view shows `unavailable` or "—" for every session of that agent.

| Agent | System prompt | Tool definitions | Usage | Cache token classes | Subagents | Compaction | Durations | Hooks |
|---|---|---|---|---|---|---|---|---|
| Antigravity CLI | not read | not read | per request | read only | not read | yes, without token counts | not read | not read |
| Claude Code | from prompt snapshots (Claude Code 2.1.268 and later) | from prompt snapshots (2.1.268 and later) | per request | read, write (5-minute and 1-hour) | yes | yes, with tokens before and after | yes | yes |
| Codex | when the rollout records it (older rollouts do not) | not recorded | per request | read, write when recorded | yes | yes, without token counts | yes | not recorded |
| DeepSeek Harness | yes | yes | per request | read, write | not recorded | yes, with tokens | not recorded | not recorded |
| DimCode | not read | not read | per run (below) | read, write | not read | not read | not read | not read |
| Gemini CLI | not recorded | not recorded | per request | read only | not recorded | yes, with tokens | not recorded | not recorded |
| Grok | when the session folder has the prompt file | when the session folder has the tools file | per turn (below) | read, write | yes | yes, with tokens | yes | yes |
| Kimi Code | yes | when the wire records them | per request | read, write | not read (below) | not read | yes | not read |
| OpenCode | not recorded | not recorded | per request | read, write | not recorded | not recorded | not recorded | not recorded |
| Pi | not recorded | not recorded | per request | read, write | not recorded | yes, with tokens | not recorded | not recorded |
| Qoder CLI | not read | not read | per request | read, write (5-minute and 1-hour) | yes | yes, without token counts | not read | not read |
| ZCode | not read | not read | per request | read, write | not read | not read | not read | not read |

Estela reads requests and token usage for every agent, and the reasoning text the model produced for every agent but DimCode and Kimi Code. A request's input tokens include its cache reads and writes wherever the agent records those classes.

When a log does not record the system prompt or tool definitions, those slots of [Model saw](concepts.md#model-saw) are `unavailable` and [Compare](workspace.md#compare) does not compare them.

## Known limits

- **Grok records usage only per turn.** Each Grok request covers one whole turn (several model calls, subagents that finished within it included), so a Grok session has one request per turn, not one per model call. Grok also logs its own cost per turn; Estela shows the list price of the recorded tokens instead ([Cost](workspace.md#cost)).
- **DimCode records usage per run.** Each DimCode request is one usage row DimCode wrote for a run of the agent, which can cover several model calls, so a DimCode session has fewer requests than model calls.
- **ZCode 0.16.5 databases cannot be read yet.** Their session table has no `time_deleted` column, which the reader expects, so the session list shows the database as one session that could not be read ([agent-kit#331](https://github.com/PerfectPan/agent-kit/issues/331)).
- **Kimi Code subagents are not read.** A Kimi Code session shows its main agent only; the subagents' wires (`agents/<id>/wire.jsonl`) are not opened.
- **Agent-logged cost is not shown.** OpenCode, Pi, Grok, ZCode, and DimCode log a cost of their own, and Codex logs a priority-tier multiplier. Estela shows the list price of the recorded tokens instead, so the cost it shows can differ from what those agents logged.
- **New log formats are rejected, not guessed.** When an agent release changes its log format in a way the reader does not know, the session shows "Could not read" with the file, line, and reason instead of a partial session. Reading resumes after an Estela release with an updated reader (see [Troubleshooting](troubleshooting.md#a-session-says-could-not-read)).
- **One line can be skipped.** A line that is not JSON is skipped and counted, and the rest of the session loads.
