# Plan 0003: Layer the CLI and route its commands with @bomb.sh/router

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-10
- Paired Spec: none (a technical refactor; the command-line changes are listed in 3.6)

This plan groups `apps/cli/src` by responsibility and replaces the CLI's two argument parsers, the
hand-written `argv.ts` and DevFrame's cac adapter, with one route table on `@bomb.sh/router`.
Terminal output stays on `@clack/prompts`.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Verification
5. Execution plan
6. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- 21 modules and 15 tests sat directly in `apps/cli/src`. `main.ts` (233 lines) parsed
  arguments, read the environment, chose the output mode, loaded sessions, wired the server, and
  called `process.exit` on each failure path.
- Arguments were parsed twice. `argv.ts` walked `process.argv` by hand, took `--pick`,
  `--no-index`, `--out-dir`, `--out`, and the session path, and passed the rest to `createCac` from
  `devframe/adapters/cac`, which `main.ts` ran last.
- Observed with `node apps/cli/bin.mjs` before this change:
  - `--version` printed `agent-trace/0.0.0`: the adapter hard-codes `cli.version("0.0.0")`.
  - `--help` listed `build` and `mcp` with DevFrame's generic descriptions and no `export-atif` or
    `export-otlp`; `export-atif --help` printed the top-level help; `build --help` listed
    `--pretty`, which `build` ignores, and `--pick` and `--no-index`, which it does not take.
  - An unknown option on the dev command was checked only after the session had loaded and every
    agent root had been indexed, and failed with a `CACError` stack trace. `build` and the export
    commands ignored an unknown option.
- DevFrame exports `createDevServer` and `resolveDevServerPort` (`devframe/adapters/dev`),
  `createBuild` (`devframe/adapters/build`), and `createMcpServer` (`devframe/adapters/mcp`). Its
  documentation names `createDevServer` as the entry for a CLI built on another framework. `cac` is
  an optional peer of `devframe`.
- `@clack/prompts` already draws every terminal moment, with plain lines when stdout is not a TTY
  or `NO_COLOR` is set.

### 1.2 Problem

The flat directory hid the data flow: nothing separated the command layer from the session
catalog, the session reader, the server wiring, or the report writer, and `main.ts` mixed all of
them with process control. The double parse produced the defects above, and each new command had
to touch both parsers.

### 1.3 Goals and success criteria

- `apps/cli/src` is grouped by responsibility (2.2). Only `cli/` parses the command line, writes to
  the terminal, and sets the exit code.
- One parse. The route table rejects unknown options and extra positionals before a session is
  loaded or indexed.
- `agent-trace --help` lists every command, each command has its own `--help`, and `--version`
  prints the package version.
- One table maps every expected failure to its message, fix line, and exit code, and the type
  checker keeps it exhaustive.
- Commands, options, defaults, environment variables, exit codes, and the plain output lines
  (`Ready:`, `Load:`, `Redact:`, `Write:`, `Wrote`) stay as they were, except the changes in 3.6.

### 1.4 Non-goals

- No change to the kernel, schema, RPC, runtime-node, or web packages, to the session catalog's
  behavior, or to the content of reports and exports.
- No new command, option, or shell completion.
- The managed dsh plugin proposed in #81 is not part of this layout. The kit's dsh provider reads
  DeepSeek Harness sessions (#70), so no capture format or installer moves into the CLI.

## 2. Outline

### 2.1 Design principles

- The entry layer reads the command line and the terminal, and calls the modules below it with
  what they need: the session target, whether to redact, a `log` function. Those modules throw
  their own errors and never print or exit.
- Move code rather than rewrite it. Apart from `main.ts` and `argv.ts`, modules keep their logic:
  `createTraceStore` takes the `log` function and `writeExport` the `redacts` flag instead of
  reaching for stderr and the environment, and otherwise only imports and paths change.

### 2.2 Boundaries and responsibilities

| Directory | Owns | Depends on |
| --- | --- | --- |
| `src/cli/` | the route table (`routes.ts`), dispatch (`app.ts`), help and version text (`help.ts`), the failure table (`failure.ts`), one module per command (`commands/`), terminal output (`ui/`) | every directory below |
| `src/sessions/` | loading one session target through the kit, trace ids and target labels, read-failure wording, `ShellPlatform` | none |
| `src/catalog/` | the session catalog: discovery, rows, summaries, the summary queue, the index cache | `sessions/` |
| `src/server/` | the DevFrame definition, the TraceStore wiring, opening the browser | `sessions/`, `paths.ts` |
| `src/report/` | building a report and packing it for `file://` | `server/` |
| `src/export/` | writing ATIF and OTLP files | none |
| `src/` | `main.ts` (process entry), `paths.ts`, `node-version.mjs`, `testsupport/` | `cli/` |

The column lists directories inside `apps/cli/src`; package dependencies follow the `apps/cli` row
of the Layers table in `AGENTS.md`.

Tests sit next to the module they test. Tests that spawn the CLI or child processes, or check one
module's output against another's, live in `apps/cli/test/`.

### 2.3 Main path

```text
bin.mjs → main() → runCli(argv)
  parse(routes, argv) ─ not ok ─→ usage failure → stderr, exit 1
    ├─ help    → helpText   → stdout, exit 0
    ├─ version → versionText → stdout, exit 0
    └─ execute → commandOf(intent) ─ usage failure → stderr, exit 1
                   ├─ /            runDev:    catalog, TraceStore, createDevServer (onReady: Ready line, browser)
                   ├─ /build       runBuild:  load once, reportOf, writeReport
                   ├─ /mcp         runMcp:    load once, seed the TraceStore, createMcpServer (stdio)
                   └─ /export-*    runExport: load once, writeExport
  CliError(failure) → failureReport → stderr or sayError → exit code
```

### 2.4 Design decisions

- **D1. Parser: `@bomb.sh/router`.** `@bomb.sh/args` (0.3.1) is a flag parser without commands,
  help, or validation; it reads `--` as an option named `""` and converts each positional that
  starts with a digit to a number (`2026-11-10.jsonl` becomes `NaN`), so session paths would need a
  second pass over argv, the double parse this plan removes. cac without DevFrame's adapter would
  fix the version and help text but keep a parser without typed routes or schema validation.
  `@bomb.sh/router` (0.8.0, MIT, one types-only dependency) matches the command line to typed
  intents (`help`, `version`, `execute`), validates each value with a Standard Schema (the
  repository's `zod/mini` schemas work unchanged), rejects tokens no route takes, and returns the
  tokens after `--` as literals. It is bundled into `dist/cli.mjs` like `@clack/prompts`.
- **D2. `AGENT_TRACE_PATH` stays a fallback the CLI reads itself.** Given an environment record,
  the router would also bind `PORT`, `HOST`, and every other option name, and `--pick` must ignore
  the variable.
- **D3. Help comes from the router's `printHelp`, under the full command name.** The printer titles
  a nested route by its path alone (`build`), so `help.ts` passes the route renamed to
  `agent-trace build`. Every route carries the version, and `--version` prints
  `agent-trace <version>`.
- **D4. Failures are one table.** `cli/failure.ts` holds the `CliFailure` union and
  `failureReport`, a `switch` that must return for every kind. Commands throw `CliError`; nothing
  below `cli/` exits. Every failure keeps exit code 1.
- **D5. Validation runs before output.** `commandOf` checks the intent (a session or option before a
  command name, `--pick` conflicts, the token after `--`) and returns the command to run, so a usage
  failure happens before the output filter or any command starts.

## 3. Detailed design

### 3.1 Route table

| Route | Argument | Options |
| --- | --- | --- |
| `/` (dev server) | `[session]` | `--port <n>`, `--host <h>` (default `localhost`), `--open`/`--no-open`, `--auth`/`--no-auth`, `--mcp`/`--no-mcp`, `--pick`, `--index`/`--no-index` |
| `/build` | `[session]` | `--out-dir <dir>` (default `dist-static`) |
| `/mcp` | `[session]` | none |
| `/export-atif`, `/export-otlp` | `[session]` | `--out <file>` |

- `session` falls back to `AGENT_TRACE_PATH` (an empty value names nothing); `build`, `mcp`, and
  the exports then fall back to the bundled demo trace. The one token after `--` counts as the
  session, for a path that starts with `-`.
- `--port` is an integer from 0 to 65535; `0` lets the OS choose.
- `open` and `mcp` are absent unless given, so DevFrame's defaults apply: the browser opens, and
  the MCP route mounts once agent tools exist. `auth` and `index` stay on unless `--no-auth` or
  `--no-index`.
- A session or option written before a command name (`agent-trace --port 1 build x`) is a usage
  failure: it belongs to the dev server, which that command never starts.

### 3.2 Dev server

`commands/dev.ts` calls `createDevServer(devframe, { host, port, mcp, auth, openBrowser, onReady })`:

- `port` is `--port`, else `resolveDevServerPort(devframe, { host })`: the definition's 7392 or
  the next free port.
- With a launch session (a path, `AGENT_TRACE_PATH`, or `--pick`), the CLI opens
  `?s=<traceId>` itself unless `--no-open`, and DevFrame opens nothing. Without one, DevFrame opens
  the session browser unless `--no-open`.
- `--no-auth` passes `auth: false`; otherwise the CLI's own browser open carries the one-time code.
- `onReady` resumes summaries, prints the Ready line, then opens the browser, in that order.

`browserPlan` in `commands/dev.ts` holds the opening and gate rules above as a pure function, and
`commands/dev.test.ts` checks each combination.

The DevFrame definition drops `cli.command` and `cli.configure`, which only the cac adapter read,
and keeps `cli.port`.

### 3.3 MCP

`commands/mcp.ts` loads the session, seeds the TraceStore, and calls
`createMcpServer(devframe, { transport: 'stdio', onReady })` from `devframe/adapters/mcp`.
stdout carries protocol only; the ready line and every failure go to stderr as plain lines.

### 3.4 Failures

| Kind | Message | Fix line | Exit |
| --- | --- | --- | --- |
| `usage` | the router's issue (``unexpected: `--bogus` ``, `--port requires a value`, `port: expected a port number from 0 to 65535`, `out: expected a path; writing to stdout (-) is not supported`), `--pick needs an interactive terminal`, `--pick cannot be used with a session path`, ``put the session and options after `build` `` | `Run agent-trace --help for usage.` | 1 |
| `session` (`load`, `build`, `export`) | `Could not <action> <target>: <reason>` | `Pass a canonical agent-trace JSON file, or a session path a registered agent adapter accepts.` | 1 |
| `index` | `Could not index sessions: <reason>` | `Check the agent session directories, or pass --no-index.` | 1 |
| `no-sessions` | `No sessions to pick.` | as for `session` | 1 |
| `cancelled` | none (the picker prints its own cancel line) | none | 1 |

Usage failures and every `mcp` failure are plain lines on stderr. Other failures go through
`sayError`: clack's error in a terminal, plain lines otherwise.

### 3.5 Dependencies

- `@bomb.sh/router` `0.8.0` joins the `apps/cli` devDependencies and is bundled. It is pinned in
  the package rather than the catalog, which holds versions shared by two or more packages. The
  existing notices plugin adds its MIT license to `THIRD-PARTY-NOTICES.txt`.
- `cac` leaves the `dependencies`, and the lockfile no longer resolves it as `devframe`'s optional
  peer. `devframe` and `@devframes/agentic` stay external.

### 3.6 Compatibility

Unchanged: command names, option names and defaults, `AGENT_TRACE_PATH` (an empty value aside,
below), `AGENT_TRACE_REDACT`, exit codes, the plain output lines, the Ready box, MCP stdout, and the
report and export files.

Changed:

- `--help` uses the router's layout and lists every command; `<command> --help` describes that
  command.
- `--version` prints `agent-trace <version>` (was `agent-trace/0.0.0 <platform> node-<version>`).
- An unknown option or a second positional fails before any work with the router's wording, on
  every command; `build --pretty` is now rejected.
- `--pick` with a session path fails; the path used to be ignored.
- A session or option written before a command name fails; it used to be ignored or misread.
- `--no-pick`, `--index`, and `--auth` are accepted as the settings they name.
- A missing value reads `--port requires a value` (was `--port needs a value`).
- `-h`/`--help` and `-v`/`--version` answer help or version wherever they appear, also where the
  old parser read them as an option's value (`--port -h` used to fail with `--port needs a value`).
- `--out -` and `--out-dir -` are refused because the CLI does not write to stdout; the old parser
  reported a missing value.
- An empty `AGENT_TRACE_PATH` names no session, so `build`, `mcp`, and the exports use the demo
  trace; it used to resolve to the working directory and fail.
- A toggle given twice (`--open --no-open`) is rejected; the old parser kept the last one.
- `--no-index` or `--pick` after `build`, `mcp`, or an export is rejected; the old parser accepted
  and ignored them.

## 4. Verification

- Unit: `cli/routes.test.ts` covers each row of 3.1, `--`, digit-leading paths, unknown options,
  missing values, `-` as an output path, the port range, help and version on every route, and both
  help texts; `cli/app.test.ts` covers the version line, the usage failures of 3.4, the token after
  `--`, and an `mcp` failure that leaves stdout empty; `cli/commands/dev.test.ts` covers
  `browserPlan`. The moved tests pass unchanged apart from paths.
- Integration: `apps/cli/test/cli-smoke.test.ts` (one read per `build`, MCP stdout) and
  `apps/cli/test/report-build.test.ts` (one redacted `index.html`, split out of
  `report/report-site.test.ts` because it starts the CLI).
- Tarball: `test:smoke` checks `--help` (`agent-trace <version>`, `Usage:`, `--pick`,
  `export-otlp`), `--version`, and an unknown flag that fails with exit 1 and nothing on stdout;
  `test:e2e` runs unchanged.
- Repository gates: format, lint, typecheck, test, build, conventions, layers, translations, and
  the browser bundle.

## 5. Execution plan

### 5.1 Preconditions

The branch starts from #80 (`feat/ledger-lane-view`), which carries #70's CLI. #81 is not included.

### 5.2 Completion contract

- The goals in 1.3 hold and the checks in 4 pass.
- `AGENTS.md`, `docs/architecture/overview.md`, `docs/development/setup.md`, both READMEs, and the
  path comment in `apps/web/src/shell/report.ts` name the new layout.

### 5.3 Execution order

One PR in three commits, each leaving the repository buildable.

#### Task 1: Group the modules

- Files: every module and test under `apps/cli/src`; the docs and comment that name their paths.
- Change: `git mv` into the directories of 2.2; rewrite relative imports; move the platform type the
  kit calls take into `sessions/` as `ShellPlatform`.
- Tests: the existing suite, with fixture paths adjusted for the new depth.
- Exit condition: `pnpm --filter @rivus/agent-trace test` and `typecheck` pass with no logic change.

#### Task 2: Route the commands

- Files: `src/cli/{routes,app,help,failure}.ts`, `src/cli/commands/*.ts`, `src/main.ts`,
  `src/server/{devframe,trace-store}.ts`, `src/export/write-export.ts`, `src/cli/ui/terminal.ts`,
  `apps/cli/package.json`, `pnpm-lock.yaml`, the bundling comments in `apps/cli/vite.config.ts` and
  `apps/cli/scripts/third-party-notices.ts`, `apps/e2e/src/cli.smoke.ts`, and a changeset; split
  `test/report-build.test.ts` out of `src/report/report-site.test.ts`; delete `src/argv.ts` and its
  test.
- Change: 3.1 to 3.5.
- Tests: `cli/routes.test.ts`, `cli/app.test.ts`, `cli/commands/dev.test.ts`, and the `test:smoke`
  cases of 4.
- Exit condition: every check of 4 passes, `test:smoke` and `test:e2e` included.

#### Task 3: Documents and release intent

- Files: this plan and its reading copy, `docs/plans/README.md`, and the docs of 5.2.
- Exit condition: `node scripts/check-doc-translations.mjs` and `gh repo-checks repository` pass.

### 5.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| Task 1 | `pnpm --filter @rivus/agent-trace test` | every moved test passes |
| Task 2 | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `node scripts/format.mjs --check` | pass |
| Task 2 | `cd apps/e2e && pnpm run test:smoke && pnpm run test:e2e` | pass on the installed tarball |
| Task 3 | `node scripts/check-*.mjs`, `gh repo-checks repository` | pass |

### 5.5 Rollback per batch

Revert the PR. Nothing persisted changes: the session index layout and `INDEX_CONTENT_REVISION` are
untouched, and reports and exports are byte-for-byte the same.

## 6. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| `@bomb.sh/router` is 0.x; its first release was 2026-09-30 | risk | an upgrade may change its API or messages | unconfirmed | the version is pinned and only `cli/` imports it; `cli/routes.test.ts` pins the messages |
| `help.ts` rewrites the router printer's usage lines and session label | risk | a printer change in an upgrade could leave the help wrong | unconfirmed | `cli/routes.test.ts` pins both help texts |
| Scripts that parse `--help` or the old `--version` output | risk | low; neither format was documented | unconfirmed | none |
