# @rivus/dsh-estela

## 0.1.2

### Patch Changes

- [#194](https://github.com/PerfectPan/estela/pull/194) [`742d878`](https://github.com/PerfectPan/estela/commit/742d87847a285ea7ab999305371f796fee5703cb) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Name the ⌘K button after what it does: "Go to events" moves focus to the event ledger, as a plain button without a search icon (CLI top bar and the dsh plugin's stats row), and the session list's button reads "Search sessions" because it focuses the search box.

- [#197](https://github.com/PerfectPan/estela/pull/197) [`6fd5018`](https://github.com/PerfectPan/estela/commit/6fd5018dd442d057ece3fde1471051351545dce4) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Keep what is looked up by out of redaction. With redaction on, an event or lane id that redaction would change (one that names the home directory, say) is shown as `@e<seq>` / `@l<n>` and every id input takes that form back, so `get-event`, "Export report", and `build` work for such ids. The MCP `cwd` filter matches the working directory as recorded, so two directories that redact to the same text are told apart. A report gives such ids their own aliases even with `ESTELA_REDACT=0`, so an exported report no longer fails to open them and two ids that redact alike do not get mixed up. Redacting a value keeps every value of object keys that redact to the same text (the later ones get `[#2](https://github.com/PerfectPan/estela/issues/2)`, `[#3](https://github.com/PerfectPan/estela/issues/3)`).

## 0.1.1

### Patch Changes

- [#193](https://github.com/PerfectPan/estela/pull/193) [`837e21d`](https://github.com/PerfectPan/estela/commit/837e21d1bdd254421f3696306d9f247563a675c9) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Expand the `@rivus/dsh-estela` README with screenshots, usage, limits, privacy details, and documentation links.

- [#190](https://github.com/PerfectPan/estela/pull/190) [`6b452eb`](https://github.com/PerfectPan/estela/commit/6b452ebd1496c6dceb4bc6ea98e4772410238e35) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Use the singular label for a count of one in the session header ("1 turn", "1 request", "1 subagent", "1 failed tool call") and in the session browser's failed tool call flag, as the compaction count already did.

## 0.1.0

### Minor Changes

- [#188](https://github.com/PerfectPan/estela/pull/188) [`49e1702`](https://github.com/PerfectPan/estela/commit/49e17023e904d8c5d9971db819a05dc790773a3a) Thanks [@PerfectPan](https://github.com/PerfectPan)! - Release the `@rivus/dsh-estela` DeepSeek Harness plugin for `dsh web`, adding an Estela View tab beside Chat and Trajectory with the session ledger, timeline, Model saw, Compare, Raw inspector, and list-price cost.
