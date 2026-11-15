# Public interface and compatibility

Audience: users who script Estela or connect it to other tools, and maintainers who decide a release's version bump. This document lists what semantic versioning covers for `@rivus/estela`, what is experimental, and what is excluded. A change to a covered surface updates this document and the [user guide](../guide/README.md) in the same pull request.

## Version policy

`@rivus/estela` is at 0.x. Until 1.0, a breaking change to a covered surface ships in a minor release with a changeset that says what changed; a fix ships in a patch release. From 1.0, a breaking change to a covered surface needs a major release, a new capability a minor one, and a fix a patch one ([Release Intent](../../CONTRIBUTING.md#release-intent)).

A change is breaking when a script, MCP client, or tool that worked with the previous version stops working or gets a different meaning: a removed or renamed command, option, environment variable, or MCP tool; a new required input; a different default; a different exit code; or a removed or renamed field in an output that is covered here. Adding an optional input, an output field, a command, or a tool is not breaking.

## Covered

### Command line

| Command | Argument | Options |
|---|---|---|
| `estela` | `[session]` (default `ESTELA_PATH`) | `--port <n>` (0–65535; default 7392 or the next free port), `--host <host>` (default `localhost`), `--open` / `--no-open` (default on), `--auth` / `--no-auth` (default on), `--mcp` / `--no-mcp` (default off), `--pick` / `--no-pick`, `--index` / `--no-index` (default on) |
| `estela build` | `[session]` (default `ESTELA_PATH`, else the bundled demo trace) | `--out-dir <dir>` (default `dist-static`) |
| `estela mcp` | `[session]` (default `ESTELA_PATH`, else every discovered session) | none |
| `estela export-atif` | `[session]` (default `ESTELA_PATH`, else the bundled demo trace) | `--out <file>` (default `estela-<session>.atif.json`) |
| `estela export-otlp` | `[session]` (default `ESTELA_PATH`, else the bundled demo trace) | `--out <file>` (default `estela-<session>.otlp.json`) |

Every command takes `-h` / `--help` and `-v` / `--version`. A session is a session file, `path#sessionId`, or a canonical Estela JSON file; a token after `--` is read as the session, for a path that starts with `-`. Parsing rules that are part of the interface:

- An unknown option, a second session, an option given twice, a toggle written with `=` (`--open=false`), or `-` as an output path is rejected before any session is read.
- A session or option written before a command name (`estela --port 1 build x`) is rejected.
- On the main command, a bare word that names a command is that command; a value with such a name is written `--host=build` or `./build`.
- `--pick` needs an interactive terminal and cannot be combined with a session.
- `--host <host>` preserves explicit loopback addresses (`127.0.0.1`, `::1`) in printed and opened URLs, and prints and opens `127.0.0.1` for `0.0.0.0` and `[::1]` for `::`. `--no-auth` is rejected before any server starts when `--host` is not a loopback address (`localhost`, `127.*`, `::1`).
- `build --out-dir` accepts only a new directory, an empty directory, or a directory whose sole entry is an earlier Estela `index.html` report, and refuses `/`, the working directory, the home directory, symbolic links, and non-directories.
- `export-atif` and `export-otlp` append `-2`, `-3`, … when the default filename already exists (including symbolic links), and refuse to write through a symbolic link passed to `--out`.

Tests that catch a change: `apps/cli/src/entry/routes.test.ts` (every route, option, default, and both help texts), `apps/cli/src/entry/app.test.ts` (usage failures, `--`, version line), and `apps/e2e/src/cli.smoke.ts` (`--help`, `--version`, an unknown flag on the installed tarball).

The wording and layout of `--help`, the progress lines, and error messages are for people and may change in any release.

### Exit codes

| Code | When |
|---|---|
| 0 | Success; `--help`; `--version` |
| 1 | Every failure: a usage error, a session that cannot be loaded, built, or exported, a port or host listen failure, an unsafe output path refusal, a failed index start, no sessions to pick, a cancelled pick, a Node.js version below 24, and any unexpected error |

The failure kinds and their exit code are one table in `apps/cli/src/entry/failure.ts`; a new kind without an entry fails the type check. `app.test.ts` and `cli.smoke.ts` assert exit 1.

### Environment variables

| Variable | Effect | Test |
|---|---|---|
| `ESTELA_PATH` | The default session of every command; empty means none | `apps/cli/src/entry/app.test.ts`; the default is stated in the help text pinned by `routes.test.ts` |
| `ESTELA_REDACT` | `0` turns redaction off for the local server and the ATIF and OTLP exports; reports and MCP results always redact | `write-export.test.ts`, `packages/server/test/agent-tools.test.ts` (S18) |
| `NO_COLOR` | Plain output lines with no escape sequences (also when stdout is not a terminal) | `apps/cli/src/entry/ui/terminal.test.ts`, `cli-smoke.test.ts` |
| `XDG_CACHE_HOME` | Where the session index lives (`$XDG_CACHE_HOME/rivus-estela/`) | `packages/runtime-node` index tests |
| `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `DSH_HOME`, `GEMINI_CLI_HOME`, `GROK_HOME`, `XDG_DATA_HOME`, `PI_CODING_AGENT_DIR` | The agents' own home overrides, read as each agent reads them | the session readers' tests in `@rivus/agent-kit` |

### Session locations

The default locations and home overrides in [Supported agents](../guide/supported-agents.md#where-sessions-are-found). Dropping an agent, or no longer finding sessions at a documented location, is breaking. A new agent version whose log format the reader rejects is fixed in a patch release.

### MCP tools

Covered: the seven tool names and their input schemas (property names, types, ranges, defaults, and that unknown properties are rejected), as listed in the [MCP tools reference](mcp-tools.md#inputs); the 40,000-character bound; the `@e<n>` / `@l<n>` id forms; and that results and errors are always redacted. Tests: `packages/server/src/agent-tools/inputs.test.ts` (schemas and error texts), `packages/server/test/agent-tools.test.ts` (tool list, schemas, walk, hostile session), `apps/e2e/src/mcp.smoke.ts` (S17, S18, and the `--mcp` HTTP route on the installed tarball), `apps/cli/test/cli-smoke.test.ts` (S10).

Result fields are documented in the [reference](mcp-tools.md#results) and will be covered from 1.0, after a review of the shapes with agent users; until then they may change in a minor release. Error texts are for people: Estela's part starts with `estela_<tool>: <field>:` for an invalid input, and DevFrame adds its own prefix.

The HTTP route `/__estela/__mcp` exists only with `--mcp` and is covered as a route serving the same seven tools. It answers only a client connected over loopback that sends a loopback `Origin` header, whatever `--host` binds; the one-time code does not gate it.

### Report file

`build` and "Export report" write one `index.html` that opens from `file://` with no server, always redacted, holding the view of every event and the originals of the first 2,000 events or 20 MB. Covered: that it is one self-contained file and that it is redacted. Its internal layout (the embedded `report-trace` JSON) is not covered. Tests: `apps/e2e/src/e2e/report.e2e.ts` (S9), `apps/cli/test/report-build.test.ts`.

### ATIF export

The mapping in [Export formats](export-formats.md#atif), pinned to ATIF v1.8, including the `extra.estela` fields it names. Moving to another ATIF version is breaking. Tests: `packages/kernel/src/export-atif.test.ts`, `export-atif-cost.test.ts`, `apps/cli/src/export/write-export.test.ts` (A1, A2); `node scripts/validate-exports.mjs` runs Harbor's validator by hand.

### List prices

Cost numbers depend on the price snapshot bundled with each release; every cost names its snapshot. A new snapshot that changes amounts is not breaking.

## Experimental

- **OTLP export.** `export-otlp` pins the OpenTelemetry GenAI semantic conventions `gen-ai-dev/1.42.0-dev`, a development version with no release. Attribute names follow that version and will change when a released version is pinned, possibly in a minor release even after 1.0. The command and its options are covered; the span and attribute mapping is not. Tests: `packages/kernel/src/export-otlp.test.ts`.

## Not covered

- **Workspace packages.** `@rivus/estela-server`, `-rpc`, `-kernel`, `-schema`, `-runtime-node`, and `-web` are private and bundled into the CLI; `@rivus/estela` exports no programmatic API.
- **The canonical trace JSON format** (`schema: "estela"`). It has no version field and changes in place; no command writes it, and a file from another version may not load.
- **The session index** (`index.sqlite`): a cache, rebuilt on any layout or version change.
- **DevFrame's RPC** between the bundled server and web app, its shared state, and its files (`~/.devframe/instances/`, `~/.estela/devframe/`).
- **URLs** inside the web app other than the server path `/__estela/`, trace ids, and the web interface's layout and wording.
- **Names from before the rename to Estela** (`@rivus/agent-trace`, `AGENT_TRACE_*`): not read.
