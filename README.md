<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="Estela">
</p>

<h1 align="center">Estela</h1>

<p align="center">
  <strong>A local viewer for agent sessions: every request, what the model saw, and what it cost.</strong>
</p>

<p align="center">
  <a href="https://perfectpan.github.io/estela/">Website</a> · <a href="https://perfectpan.github.io/estela/docs/guide/">Docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rivus/estela"><img src="https://img.shields.io/npm/v/@rivus/estela?style=flat-square" alt="npm version"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@rivus/estela?style=flat-square" alt="Node.js 24 or later"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@rivus/estela?style=flat-square" alt="GPL-3.0-only"></a>
</p>

<p align="center">
  <img src="docs/assets/workspace-dark.webp" width="800" alt="The Estela workspace: a session's timeline of requests and a compaction, the event ledger, and the context the model saw at one request">
</p>

```sh
npx @rivus/estela
```

Needs Node.js 24 or later, on macOS, Linux, or Windows. It lists the sessions of the agents on this machine and opens them in your browser. Nothing leaves your machine.

## Why

Agents keep detailed logs, but the logs are hard to read. When an agent goes wrong, you want to know what it actually had in front of it. Estela answers three questions from the logs alone:

- **Why did the agent do that?** For any request, Estela rebuilds the context the model received: the system prompt, the tools, the earlier messages, and the current turn.
- **What did a compaction remove?** It shows which events a compaction took out of the model's view, and compares the context before and after.
- **Where did the tokens and money go?** It shows the recorded tokens per request, turn, subagent, and session, and their list price.

Anything a log does not record is shown as `unavailable`, never estimated.

## Features

- **Session browser.** Every session on this machine in one list, newest first, with turns, requests, tokens, duration, and marks for compaction, subagents, and failed tool calls. Filter by agent, project, and flag; search titles and your own prompts.
- **Timeline and ledger.** One bar per request (height is the input tokens), one row per subagent, compactions marked with the tokens before and after; every event in order, by turn or by agent.
- **Model saw.** The context at any event, slot by slot, with the token counts the agent recorded and the events a compaction removed.
- **Compare.** The context of two requests side by side: what entered, what a compaction hid, and whether the system prompt or tools changed.
- **Cost.** The list price of the recorded tokens per request, turn, subagent, and session, with cache shares; partial sums say how many requests they leave out.
- **Reports and exports.** One redacted `index.html` to share, an ATIF v1.8 trajectory for Harbor, and an OTLP/JSON trace for Langfuse, LangSmith, or Phoenix.
- **MCP tools.** `estela mcp` lets an agent find an earlier session and read what its model saw at a failing request.

## Supported agents

| Agent | Sessions found in |
|---|---|
| Antigravity CLI | `~/.gemini/antigravity-cli/brain/` |
| Claude Code | `~/.claude/projects/` |
| Codex | `~/.codex/sessions/`, `~/.codex/archived_sessions/` |
| DeepSeek Harness | `~/.dsh/sessions/` |
| DimCode | `~/.dimcode/v2/dimcode.sqlite` |
| Gemini CLI | `~/.gemini/tmp/` |
| Grok | `~/.grok/sessions/` |
| Kimi Code | `~/.kimi-code/sessions/` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Pi | `~/.pi/agent/sessions/` |
| Qoder CLI | `~/.qoder/projects/` |
| ZCode | `~/.zcode/cli/db/db.sqlite` |

Each agent's home override is honored. What each agent's log records (system prompt, tool definitions, usage, subagents, compaction) differs; see [Supported agents](docs/guide/supported-agents.md).

## Privacy

Estela runs locally, binds `localhost`, and only reads the session logs. It keeps an unredacted cache of session titles, paths, numbers, and up to 200 of your prompts per session in `~/.cache/rivus-estela/`, which you can delete at any time. Redaction replaces your home directory, some token shapes, and the values of labelled credentials such as `PASSWORD=`, but not every secret, and a report still contains session text and file contents: read a report before you share it. Details in [Privacy and redaction](docs/guide/privacy.md).

## Documentation

- [User guide](docs/guide/README.md): getting started, concepts, the workspace, reports and exports, MCP tools, troubleshooting.
- [Public interface](docs/reference/public-interface.md): commands, options, exit codes, environment variables, and what semver covers.
- [Export formats](docs/reference/export-formats.md): the ATIF and OTLP mappings.
- [Architecture](docs/architecture/overview.md), [development setup](docs/development/setup.md), [visual design](docs/design/README.md), [contributing](CONTRIBUTING.md), and [security](SECURITY.md).

## Development

The repository is a pnpm workspace. Building from source needs Node.js `^26.13.1`; the built CLI runs on Node.js 24 or later.

```sh
pnpm install
pnpm build
node apps/cli/dist/bin.mjs
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the first-contribution steps and the checks.

## Name

_Estela_ is Spanish for a wake: the trail a ship leaves on the water. A session log is the trail an agent leaves behind, and Estela reads it. The package is published in the `@rivus` scope; _rivus_ is Latin for a stream.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
