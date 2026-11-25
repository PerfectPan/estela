# @rivus/estela

Versions up to 0.1.0 were published as `@rivus/agent-trace`.

## 0.6.1

### Patch Changes

- [#190](https://github.com/PerfectPan/estela/pull/190) [`6b452eb`](https://github.com/PerfectPan/estela/commit/6b452ebd1496c6dceb4bc6ea98e4772410238e35) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Use the singular label for a count of one in the session header ("1 turn", "1 request", "1 subagent", "1 failed tool call") and in the session browser's failed tool call flag, as the compaction count already did.

## 0.6.0

### Minor Changes

- [#165](https://github.com/PerfectPan/estela/pull/165) [`5c4f12c`](https://github.com/PerfectPan/estela/commit/5c4f12c3be6525c41cf801f65233cab08b0fdd1f) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Read more of each agent's log, from `@rivus/agent-kit` 0.27.0: DeepSeek Harness request durations, local subagents as lanes, and hooks; OpenCode and ZCode durations, compactions with their token counts, and subagent lanes; ZCode's recorded system prompt; DimCode run durations and reasoning; Kimi Code reasoning, compactions, hooks, and subagents; Codex tool definitions, hooks, and the token count before a compaction. ZCode 0.16.5 databases are read. A subagent the session records but whose log is missing shows a lane marked "log unavailable". A DimCode session keeps its cached summary across a start where nothing was written to it, as OpenCode and ZCode sessions do. On Windows, a session path typed with `\` is read by the kit itself.

- [#168](https://github.com/PerfectPan/estela/pull/168) [`a37c38b`](https://github.com/PerfectPan/estela/commit/a37c38b76a7694f89a8d3686208d45880208f83e) Thanks [@PerfectPan](https://github.com/PerfectPan)! - `estela_list_sessions` and `estela_search_sessions` now include each session's list cost (`costUsd`, `unpricedRequests`) and the price snapshot (`pricesVersion`), and `estela_session_summary` marks a subagent lane whose log is missing with `unavailable: true`.

- [#167](https://github.com/PerfectPan/estela/pull/167) [`a37c8f9`](https://github.com/PerfectPan/estela/commit/a37c8f9fe9809e4e14b1c3a2935771d97b1ead5c) Thanks [@PerfectPan](https://github.com/PerfectPan)! - The session browser's preview shows each session's list cost, priced from the request fields the kit's summary returns by the rules the workspace uses, so it matches the session header; it names the price snapshot, and cached costs are recomputed when the bundled prices change. A Codex request on the priority tier is priced at the tier's multiple of the list price.

### Patch Changes

- [#183](https://github.com/PerfectPan/estela/pull/183) [`1102350`](https://github.com/PerfectPan/estela/commit/1102350a11b3aebd0b58b701d5bdb8b552ee88f2) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Raw shows the original of an unchanged record in a compressed session log (such as a zstd log) after the log grew while the session was open, instead of reporting that the line holds a different record.

- [#184](https://github.com/PerfectPan/estela/pull/184) [`c6e8490`](https://github.com/PerfectPan/estela/commit/c6e8490c75ad9c9aed9c334468f91634711abf5c) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Raw reports the original of a compressed session log record as unavailable when the record is rewritten while the session is open, instead of displaying the rewritten record.

- [#178](https://github.com/PerfectPan/estela/pull/178) [`2f9dfaa`](https://github.com/PerfectPan/estela/commit/2f9dfaa8d673eaa00582da3c69bbeb9f29f0c7d8) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Show an indeterminate progress bar without `aria-valuenow` while the session file size is unknown (such as before `load-trace` reports total bytes or in embedded hosts), honoring `prefers-reduced-motion`.

- [#188](https://github.com/PerfectPan/estela/pull/188) [`49e1702`](https://github.com/PerfectPan/estela/commit/49e17023e904d8c5d9971db819a05dc790773a3a) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Document the `@rivus/dsh-estela` plugin boundary in the public interface reference and user guide.

- [#169](https://github.com/PerfectPan/estela/pull/169) [`5358a47`](https://github.com/PerfectPan/estela/commit/5358a47282d389c2f56980bc53a159aef25bbe61) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Point "could not read" errors for an unknown format generation to the issue tracker in both the CLI and the web UI.

## 0.5.0

### Minor Changes

- [#162](https://github.com/PerfectPan/estela/pull/162) [`39b3cb5`](https://github.com/PerfectPan/estela/commit/39b3cb599b98fd6fd5a6382240a636876b1d3dc9) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Read Antigravity CLI, DimCode, Kimi Code, and Qoder CLI sessions, and list ZCode, which was already read, by its product name. Redaction now also replaces Stripe, GitLab, Hugging Face, and Google keys, JWTs, Slack webhook URLs, the values of credential assignments such as `PASSWORD=` and `client_secret:`, `Authorization` header values, and URL passwords. A session title or first prompt cut inside a home path no longer shows the start of the user name, in any spelling. Both come from `@rivus/agent-kit` 0.26.0. ZCode and DimCode sessions now see commits still in the database's write-ahead log, as OpenCode sessions did. An OpenCode or ZCode session keeps its cached summary across a start where nothing was written to it, and `estela_list_sessions` reports `sizeBytes` 0 for it, since the database file holds other sessions too.

- [#157](https://github.com/PerfectPan/estela/pull/157) [`6b74185`](https://github.com/PerfectPan/estela/commit/6b74185dc6a586600fe900305a1fd30b5c7436f9) Thanks [@PerfectPan](https://github.com/PerfectPan)! - `estela --mcp` now requires a bearer token on the HTTP MCP route: clients send `Authorization: Bearer <token>` with the token printed at startup, or set `ESTELA_MCP_TOKEN` to choose one that survives restarts. `--mcp` is refused with a `--host` that is not a loopback address.

### Patch Changes

- [#78](https://github.com/PerfectPan/estela/pull/78) [`9845827`](https://github.com/PerfectPan/estela/commit/9845827fe2e21312291a96963fe67b8e7a32bdef) Thanks [@renovate](https://github.com/apps/renovate)! - The CLI bundle and the bundled web UI are built with Vite+ 1.5.0 (Vite 8.3.5 and Rolldown 1.2.16; the CLI bundle also moves to tsdown 0.23.4).

## 0.4.0

### Minor Changes

- [#133](https://github.com/PerfectPan/estela/pull/133) [`b59d076`](https://github.com/PerfectPan/estela/commit/b59d07641f32545217287620489ef42bb2e819e0) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Fix CLI port and loopback host handling and harden Estela against untrusted session content:
  
  - Exit cleanly with code 1 and a plain diagnostic when `--port` is already in use or listening fails ([#125](https://github.com/PerfectPan/estela/issues/125)).
  - Preserve explicit loopback hosts such as `127.0.0.1` and `[::1]` in the printed and opened URLs instead of rewriting to `localhost` ([#126](https://github.com/PerfectPan/estela/issues/126)).
  - Refuse `--no-auth` with non-loopback `--host` values, emit a startup warning when `--no-auth` is active, lock browser WebSocket/SSE `Origin` checks to the server's bound host and port (restricting wildcard binds to loopback and local interface IP literals), and restrict `~/.estela/devframe/` to mode `0700` on POSIX.
  - Refuse to wipe `/`, cwd, home, symlinks, non-directories, or unrelated non-empty directories in `build --out-dir` (while still allowing rebuilds over an earlier Estela report).
  - Use exclusive `-2`/`-3` suffix allocation for default ATIF/OTLP export filenames and refuse overwriting symbolic links passed to `--out`.
  - Enforce strict Content Security Policy headers on dev pages and `file://` reports, bound Zstandard decompression (512 MiB) and canonical trace JSON reads (256 MiB), harden read-only SQLite pragmas, and strip non-SGR terminal escape sequences and bidi format characters from error messages, DevFrame logs, and auth banners.

- [#140](https://github.com/PerfectPan/estela/pull/140) [`ab2c03e`](https://github.com/PerfectPan/estela/commit/ab2c03ec1608a4c8ab0d2ae8ab6500d95dd1d2e7) Thanks [@PerfectPan](https://github.com/PerfectPan)! - - With `--host 0.0.0.0` the printed and opened URLs use `http://127.0.0.1:<port>`, and with `--host ::` they use `http://[::1]:<port>`, instead of a `localhost` URL that another program on the other address family could answer ([#135](https://github.com/PerfectPan/estela/issues/135)).
  - A click on a subagent lane of the timeline selects that lane's request, and Shift-click there picks the request to compare with; the lane draws the selected and compared requests with rings.
  - The `--mcp` HTTP route serves only the seven Estela tools, as `estela mcp` does, without DevFrame's shared-state tool.
  - Stopping the local server or `estela mcp` with Ctrl-C, SIGTERM, or a closed terminal first writes the finished session summaries to the index, so the next launch does not compute them again.

### Patch Changes

- [#144](https://github.com/PerfectPan/estela/pull/144) [`569b329`](https://github.com/PerfectPan/estela/commit/569b3297b31499835d6bce749430aba49ab66b4c) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Windows fixes found by running the test suites on Windows:
  
  - Session paths reach the session reader with `/` separators, so a Claude Code session opened by path shows its subagents, and a Codex rollout or a Grok session given by path is recognized. A session opened by path gets the same trace id as when it is picked from the session list, as long as the path is spelled with the same letter case. Trace ids of Windows sessions change once with this release: a saved `#/s/<id>` link from an earlier version no longer opens its session, and the session index computes those summaries again.
  - `export-atif` and `export-otlp` without `--out` skip a default file name taken by a dangling symbolic link instead of writing to the link's target.
  - When several `estela` processes open a broken session index at the same time, the one rebuilding it waits for the others to close the file instead of running without the index.

## 0.3.1

### Patch Changes

- [#130](https://github.com/PerfectPan/estela/pull/130) [`e538b5e`](https://github.com/PerfectPan/estela/commit/e538b5eab72dcf4cf62c9a724e54a220e0bc522f) Thanks [@PerfectPan](https://github.com/PerfectPan)! - The bundled web UI moves to Solid 1.9.19, which carries upstream bug fixes and clears the seroval advisories that npm audit reports against Solid 1.9.15; seroval itself is not part of the browser bundle.

## 0.3.0

### Minor Changes

- [#114](https://github.com/PerfectPan/estela/pull/114) [`cc8c52d`](https://github.com/PerfectPan/estela/commit/cc8c52d6dd35dc289cb279ded0e370ad14272310) Thanks [@nyx-cell](https://github.com/nyx-cell)! - The workspace inspector has a Compare tab: pick another request of the same lane (or the request before the last compaction) and see which events entered the context, which a compaction hid, whether the system prompt or tools changed, and the change in recorded input tokens.

- [#116](https://github.com/PerfectPan/estela/pull/116) [`ff3b26e`](https://github.com/PerfectPan/estela/commit/ff3b26e3c7843d42e455c94c8155d1f88f19e050) Thanks [@nyx-cell](https://github.com/nyx-cell)! - The workspace and reports show what a session's recorded tokens cost at LiteLLM list prices: the session total with its cache hit rate, per turn, per agent, and per request with input, cache, and output shares. Requests without usage or with an unlisted model show cost as unavailable with the reason, and partial sums say how many requests they leave out. `export-atif` writes the same cost to ATIF's `cost_usd` fields.

### Patch Changes

- [#128](https://github.com/PerfectPan/estela/pull/128) [`0f4ca6b`](https://github.com/PerfectPan/estela/commit/0f4ca6b72e9fb3b415c1ab0e5973f504b4dba314) Thanks [@nyx-cell](https://github.com/nyx-cell)! - The help text, the MCP tool descriptions, and the package description say "agent" instead of "coding agent".

## 0.2.0

### Minor Changes

- [#68](https://github.com/PerfectPan/estela/pull/68) [`efcc621`](https://github.com/PerfectPan/estela/commit/efcc6213ea0821d264dc60c0ba973e59a948d73f) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Add export-atif and export-otlp: write a session as one ATIF v1.8 trajectory (for Harbor datasets and evaluation) or one OTLP/JSON request with OpenTelemetry GenAI attributes (for Langfuse, LangSmith, and Phoenix). Exports are redacted unless ESTELA_REDACT=0.

- [#70](https://github.com/PerfectPan/estela/pull/70) [`58d876a`](https://github.com/PerfectPan/estela/commit/58d876a2e6ed0a55cf4bb5bab71dceb2835a5485) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Read Pi, DeepSeek Harness and OpenCode sessions. The session list, workspace, reports, and exports find Pi's JSONL sessions, DeepSeek Harness's Zstandard logs, and OpenCode's SQLite database; a session in a shared database is opened as `opencode.db#<sessionId>`. `get-event` returns the original record of a compressed line or a database row, and a record changed since the session was loaded comes back as unavailable with the reason. A report decompresses a compressed log once for all of its events instead of once per event. The agent rail, picker, and marks use the product names Pi, DeepSeek Harness, OpenCode, and Gemini CLI, Claude sessions under a chats directory still load as Claude, and the README lists the new agents' homes and overrides.
  
  Sessions that share one OpenCode database keep independent cached summaries and search entries: each cache entry follows that session's own last write, and reading an original rejects a row changed after the session was loaded. A large OpenCode database does not make its sessions' summaries run one at a time.
  
  Keep the DSH and Pi marks readable at the list's small text size in both themes, and improve Gemini CLI's contrast on light backgrounds.

- [#80](https://github.com/PerfectPan/estela/pull/80) [`97415fa`](https://github.com/PerfectPan/estela/commit/97415fa996cf1a346bd95a0c152aafeee621a791) Thanks [@PerfectPan](https://github.com/PerfectPan)! - The ledger can list events by agent: the Turns / Agents toggle in the ledger bar draws one collapsible header per agent, the main agent first, with that agent's events under it. The kind chips, the time range, and the selected event carry over between the two layouts.

- [#118](https://github.com/PerfectPan/estela/pull/118) [`b09fca8`](https://github.com/PerfectPan/estela/commit/b09fca8c9d7292722a565ed0f761182370a7c703) Thanks [@nyx-cell](https://github.com/nyx-cell)! - `estela mcp` gives coding agents seven read-only tools to inspect earlier sessions: list and search sessions, a session summary, turns, model requests, one event, and the reconstruction at an event, each with a named input schema and a bounded, always redacted result. Without a path it serves every session on the machine instead of the demo trace. The dev server serves these tools over HTTP only with `--mcp`, because that route is not gated by the one-time code.

- [#107](https://github.com/PerfectPan/estela/pull/107) [`055fccf`](https://github.com/PerfectPan/estela/commit/055fccf59f683a35c8523a6246c5fcb5589bd79f) Thanks [@nyx-cell](https://github.com/nyx-cell)! - The project is now Estela: install and run it as `@rivus/estela` with the `estela` command, and rename `AGENT_TRACE_*` environment variables to `ESTELA_*` (old names are no longer read). The session index cache moved to `rivus-estela`; the old `rivus-agent-trace` cache directory can be deleted.

### Patch Changes

- [#83](https://github.com/PerfectPan/estela/pull/83) [`a2db8ab`](https://github.com/PerfectPan/estela/commit/a2db8ab7b7d24a6c7851cbb4a3aa7a7e3f6d3e09) Thanks [@PerfectPan](https://github.com/PerfectPan)! - The CLI now reads its command line once, through one route table: an unknown, repeated, or misplaced flag, a toggle written as `--open=false`, an out-of-range value, or a second session path fails with the cause and one fix line before any session is read or indexed, `estela <command> --help` describes each command (the top-level help lists `export-atif` and `export-otlp` too), and `--version` prints the package version instead of `0.0.0`. `--pick` with a session path and `build --pretty` are refused, an empty `ESTELA_PATH` counts as unset, a host that is also a command name is written `--host=build`, and `-h` or `-v` after an option that takes a value prints the help or the version.

- [#119](https://github.com/PerfectPan/estela/pull/119) [`3b497bd`](https://github.com/PerfectPan/estela/commit/3b497bd1de59695ca3cc4816dc83ccf7b5fee107) Thanks [@nyx-cell](https://github.com/nyx-cell)! - The bundled demo trace that `build`, `mcp`, and the exports open when no session is named is now a realistic Claude Code session: five turns with 34 requests and cache token counts, a `/compact`, two subagents, three failed tool calls, hooks, and prompt snapshots. All of it is invented.

- [#113](https://github.com/PerfectPan/estela/pull/113) [`7be92a6`](https://github.com/PerfectPan/estela/commit/7be92a64d633b3c84c6c387e4ce6e568ac4f41d9) Thanks [@nyx-cell](https://github.com/nyx-cell)! - Update DevFrame to 1.3.3. With the default `--host localhost`, the server listens on both 127.0.0.1 and ::1, and moves to the next free port when 7392 is taken on either address.

- [#72](https://github.com/PerfectPan/estela/pull/72) [`4d9610c`](https://github.com/PerfectPan/estela/commit/4d9610c3d1d9b8e5a048f9f6269bec2568c1e785) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Fix a flaky session index open under concurrent launches: node:sqlite reports extended result codes, and a reader that opens while another process converts the index to WAL or rebuilds it got SQLITE_BUSY_RECOVERY (261) or SQLITE_IOERR, which the open loop classified as fatal and gave up on the index. Busy and I/O errors are now matched as primary codes and retried until the open deadline.

- [#74](https://github.com/PerfectPan/estela/pull/74) [`dec702e`](https://github.com/PerfectPan/estela/commit/dec702e66d3669ea06a85191cec853a865be1fcf) Thanks [@renovate](https://github.com/apps/renovate)! - Update bundled Zod to 4.6.6 so oversized arrays, sets, and maps with size limits are rejected before their elements are validated.

- [#66](https://github.com/PerfectPan/estela/pull/66) [`e02d41a`](https://github.com/PerfectPan/estela/commit/e02d41a489f91a0be2e301e0c353f432bbc3429b) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Match the browser favicon to the new project logo.

- [#87](https://github.com/PerfectPan/estela/pull/87) [`8d49550`](https://github.com/PerfectPan/estela/commit/8d49550df4d9a05968c74bd82c847a7ef84e5379) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Refresh bundled dependency resolution with the regenerated pnpm lockfile.

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
