# @rivus/agent-trace

## 0.1.0

### Minor Changes

- The CLI requires Node.js 24, accepts a session path, and prints plain progress when output is piped or NO_COLOR is set.

- Sessions from Claude Code, Codex, and Grok load through one adapter protocol, including request usage, compaction, subagents, and hooks.

- Open a session browser over every Claude Code, Codex, and Grok session on this machine, with search, filters, a SQLite session index, and English and Chinese UI.

- Add the view trace (toView, fitView), timeline and ledger projections, reconstruct slot counts, and the load-trace, get-trace-view, and get-event RPCs with load progress and cancellation

- The session workspace shows load progress, the session header, an SVG timeline with a range brush, a virtualized ledger grouped by turn, and an inspector with Input, Output, Model saw, and Raw, in both themes and in English and Chinese.

- Ship one bundled package: dist/bin.mjs checks Node.js, dist/cli.mjs bundles the shell and workspace packages, and the web build is copied to dist/web; the Ready box shows one clickable URL

- Export a redacted report of one session from the workspace or with `build`; the report is a single index.html that opens from disk without a server, in the language it was exported in.

### Patch Changes

- Redaction also replaces the home directory inside git diff headers (a/<home>/…), without its leading slash, and JSON-escaped, in the local server, reports, and MCP.

- Read Claude Code prompt snapshots and the Codex base instructions, so Model saw shows the system prompt and tools a session recorded instead of unavailable

- Redaction now also hides PEM private key blocks, more token families (ASIA, gho_, ghu_, ghs_, ghr_, github_pat_, npm_) and more spellings of the home directory (URL-encoded, ~user, Windows forms). A token prefix glued to a preceding letter or digit is no longer redacted, which keeps words like `task-...` readable.

- Sessions are now read end to end through agent-kit. Claude Code sessions whose records carry no request id now show request and token counts; sessions under CLAUDE_CONFIG_DIR, CODEX_HOME, or GROK_HOME are found (an override replaces the default home), archived Codex sessions are listed; a malformed log line no longer fails a session — the session loads and the line is skipped; a session directory that cannot be read now shows as an error row instead of being left out silently; and Grok tool calls show the full arguments in the inspector, with the update's input keys merged in.

- Search now indexes the user's own prompts only (not injected or system text), and summarizing a large session no longer loads it whole.

- Upgrade @rivus/agent-kit to 0.21.1: Claude Code sessions whose records open with host-added text (system reminders, IDE context) now count turns and take prompts and titles from the user's text, and the trace view keeps that context in its own turn, so the session index recomputes once after upgrading. Homes hidden after a JSON escape, URL encoding or an ANSI colour are now redacted.
