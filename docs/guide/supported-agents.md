# Supported agents

Estela reads the logs of twelve agents. The readers live in [`@rivus/agent-kit`](https://www.npmjs.com/package/@rivus/agent-kit) 0.27.0, bundled into the CLI.

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

What Estela can show depends on what the agent writes to its log. This table comes from the capabilities each reader declares and the conformance fixtures under `fixtures/sessions/<agent>/conformance/` that `packages/server/src/sessions/conformance.test.ts` runs. "Tested against" lists an agent version when the kit's source or README says the reader was verified or captured on it, plus any log-format version recorded in those conformance fixtures; where neither is recorded, it says "not recorded". "Not recorded" in a capability column means the agent's log does not hold that data, and "not read" means the reader does not take it from the log, whether or not the agent records it; either way the matching view shows `unavailable` or "—" for every session of that agent.

| Agent | Tested against | System prompt | Tool definitions | Usage | Cache token classes | Subagents | Compaction | Durations | Hooks |
|---|---|---|---|---|---|---|---|---|---|
| Antigravity CLI | 1.5.10 | not read | not read | per request | read only | not read | yes, without token counts | not read | not read |
| Claude Code | not recorded | from prompt snapshots (Claude Code 2.1.268 and later) | from prompt snapshots (2.1.268 and later) | per request | read, write (5-minute and 1-hour) | yes | yes, with tokens before and after | yes | yes |
| Codex | not recorded | when the rollout records it (older rollouts do not) | when the rollout records them | per request | read, write when recorded | yes | yes, with tokens before | yes | yes |
| DeepSeek Harness | format v4 (agent version not recorded) | yes | yes | per request | read, write | yes (local subagents) | yes, with tokens | yes | yes |
| DimCode | 0.5.27 | not read | not read | per usage record (below) | read, write | not read | not read | per run | not read |
| Gemini CLI | not recorded | not recorded | not recorded | per request | read only | not recorded | yes, with tokens | not recorded | not recorded |
| Grok | format v1 (agent version not recorded) | when the session folder has the prompt file | when the session folder has the tools file | per turn (below) | read, write | yes | yes, with tokens | yes | yes |
| Kimi Code | 2.6.0 (wire protocol 1.5) | yes | when the wire records them | per request | read, write | yes | yes, with tokens | yes | yes |
| OpenCode | not recorded | not recorded | not recorded | per request | read, write | yes | yes, with tokens before | yes | not recorded |
| Pi | format v3 (agent version not recorded) | not recorded | not recorded | per request | read, write | not recorded | yes, with tokens | not recorded | not recorded |
| Qoder CLI | 1.1.88 | not read | not read | per request | read, write (5-minute and 1-hour) | yes | yes, without token counts | not read | not read |
| ZCode | not recorded | per conversation | not read | per request | read, write | yes | yes, with tokens | yes | not read |

Estela reads requests, token usage, and the reasoning text the model produced for every agent. A request's input tokens include its cache reads and writes wherever the agent records those classes.

When a log does not record the system prompt or tool definitions, those slots of [Model saw](concepts.md#model-saw) are `unavailable` and [Compare](workspace.md#compare) does not compare them.

## Known limits

- **Grok records usage only per turn.** Each Grok request covers one whole turn (several model calls, subagents that finished within it included), so a Grok session has one request per turn, not one per model call. Grok also logs its own cost per turn; Estela shows the list price of the recorded tokens instead ([Cost](workspace.md#cost)).
- **DimCode records usage per settlement, not per model call.** Each DimCode request is one row of DimCode's usage ledger. A run of the agent can write more than one, and one row can cover several model calls.
- **A subagent's log can be missing.** When a session records a subagent whose own log is gone or cannot be read, the timeline still shows its lane, marked "log unavailable", with no events.
- **The session list can lag a running subagent.** A subagent that keeps a log of its own can run ahead of the list: the list recomputes a session's numbers when the parent session's own log changes.
- **Agent-logged cost is not shown.** OpenCode, Pi, Grok, ZCode, and DimCode log a cost of their own. Estela shows the list price of the recorded tokens instead (with Codex's priority tier at its multiple), so the cost it shows can differ from what those agents logged.
- **New log formats are rejected, not guessed.** When an agent release changes its log format in a way the reader does not know, the session shows "Could not read" with the file, line, and reason instead of a partial session. Once the updated reader ships in `@rivus/agent-kit`, Estela publishes a patch release so reading resumes after updating (`npx @rivus/estela@latest`). Report an unsupported format on the [issue tracker](https://github.com/PerfectPan/estela/issues/new/choose) (see [Troubleshooting](troubleshooting.md#a-session-says-could-not-read)).
- **One line can be skipped.** A line that is not JSON is skipped and counted, and the rest of the session loads.
