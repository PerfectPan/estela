# Spec 0010: Estela as a dsh plugin

## Status

Draft

Paired Plan: [`docs/plans/0010-dsh-plugin.md`](../plans/0010-dsh-plugin.md)

## Problem And Scope

Estela reads DeepSeek Harness (dsh) session logs from disk, but a dsh user has to leave the harness and run a
second command to see them ([issue #109](https://github.com/PerfectPan/estela/issues/109)). This Spec defines a dsh
plugin that shows the workspace of the current session inside `dsh web`, as a View beside dsh's Chat and Trajectory
Views: every request, what the model saw at a request, how the contexts of two requests differ, what a compaction
removed, and what the session cost.

Included: installing the plugin into the `web` profile; the Estela View; the View's loading, empty, and error states;
large sessions; redaction; theme and language; uninstalling; who may read a session; and dsh's behavior when its
version is outside the supported range.

Excluded: live follow of a running session ([#104](https://github.com/PerfectPan/estela/issues/104)); replacing
Trajectory; a time view; a `/estela` command; a session browser inside dsh; "Export report"; the ATIF and OTLP
exports; Dim ([#110](https://github.com/PerfectPan/estela/issues/110)); dsh Desktop, which is not verified; and the
TUI profile.

What dsh itself does is stated from two verifications on `@deepseek-ai/dsh` 0.2.2-rc.5 and from reading its source
at tag `dsh-v0.2.2-rc.5`. Each scenario names the test that confirms it.

## Behavioral Requirements

### Installation and the Estela View

- The plugin is the npm package `@rivus/dsh-estela`. It is installed with
  `dsh plugin --profile web add @rivus/dsh-estela` and removed with
  `dsh plugin --profile web remove @rivus/dsh-estela`.
- The plugin has no configuration of its own.
- The plugin starts no process, listens on no port, and registers no HTTP route of its own. It reads the session log
  in dsh's own process and sends the data to the browser over dsh's own connection.
- The Estela View always shows the session that the conversation shows, never another one.

**DSH-1: The Estela tab appears**

- Given `dsh` at a version inside the supported range (DSH-13) and its `web` profile,
- When the user runs `dsh plugin --profile web add @rivus/dsh-estela` and then starts `dsh web`,
- Then the install succeeds, and a session that has started shows the View tabs beside Chat and Trajectory, among
  them one labeled "Estela".

**DSH-2: The Estela View shows the current session's workspace**

- Given a session is open in `dsh web` and its log on disk can be read,
- When the user selects the Estela tab,
- Then the View shows the workspace of that session: a compact stats bar with the session numbers, list cost, and a
  "Go to events" button (`⌘K` / `Ctrl+K`) — without Estela's standalone top bar or a duplicated session title heading — plus
  the timeline, the ledger, and the inspector with its Input, Output, Model saw, Compare, and Raw tabs.
- And it shows the same content the `estela` command line shows for the same log file: Model saw reconstructs the
  context the model had at the selected request, and Compare shows how the contexts of two requests of one lane
  differ, including the events a compaction removed between them.
- And the View fills the area dsh gives a View and scrolls inside itself.
- And it offers no "Export report" button.

### A session that has not started

**DSH-3: A blank session**

- Given the open session is blank (no turn has started),
- When the user looks at the conversation,
- Then dsh shows no View tabs, so there is no Estela tab. This is dsh's own behavior; the plugin adds nothing to
  that screen and offers no command there.
- To reach Estela, the user starts the session, or selects a session that has started in dsh's session list.

### States of the Estela View

**DSH-4: A session without a log**

- Given a session has started but its log is not on disk yet,
- When the Estela View opens,
- Then it shows the notice "This session has no log on disk yet." and no error details.
- And `dsh web` keeps working.

**DSH-5: A log that cannot be read**

- Given the open session's log cannot be read: it is missing or unreadable, its format generation is unknown to
  Estela's reader or to dsh itself, or its decompressed size is over the limit,
- When the Estela View opens,
- Then it shows "Could not open this session" with the reason, with the agent, file, and line when the error names
  them, and a "Try again" button.
- And when the reason is an unknown format generation, it shows the same hint as the command line: "This agent may
  have changed its log format. Update Estela, or report the agent name, version, and reason line:" and a "Report on
  GitHub" link to `https://github.com/PerfectPan/estela/issues/new/choose`.
- And it shows no link back to a session browser, because there is none inside dsh.
- And `dsh web` keeps working: Chat, Trajectory, and the session are not affected.

**DSH-6: An error stays inside the View**

- Given any failure while the Estela View is mounted: a call to the plugin fails (the transport fails, the call is
  refused, or the plugin is removed while the call is running), or the workspace fails while drawing,
- When the failure happens,
- Then the Estela View says that it could not load the session and offers "Try again".
- And the failure stays inside the View: `dsh web` shows no blank page and no error page, and its other Views keep
  working.
- And "Try again" asks for the session again, so it succeeds once the cause is gone. The View is not remounted.

### Large sessions and running sessions

**DSH-7: Loading**

- Given the session's log takes time to read,
- When the Estela View opens,
- Then it shows "Opening session" with a loading indicator that states no progress.
- And the rest of `dsh web` stays usable while the session loads: a request that `dsh web` handles itself waits at
  most about N ms longer than without the load. N is the figure the smoke test records.

**DSH-8: A view over the 12 MB budget**

- Given a session whose view does not fit the 12 MB view budget at the default text length,
- When the Estela View opens,
- Then long strings are shortened to the longest length that fits, as in the command line, and the View says
  "Long text is shortened to N characters to keep this view under 12 MB. Select an event to load its full text."
- And selecting an event loads its full text.
- Given the view does not fit even with the shortest text,
- When the Estela View opens,
- Then it still opens and says "This session is larger than the 12 MB view budget even with the shortest text, so
  the page may be slow."
- And selecting an event still loads its full text.

**DSH-9: A session that is still running**

- Given the session is still running and its log grew after the Estela View loaded,
- When the View is on screen,
- Then it keeps showing the log as it was when it loaded. It does not follow the session.
- When the user reloads the `dsh web` page and opens the Estela View again, it shows the log as it is on disk then.
- And it never mixes two states of the log: an event that can no longer be read from the snapshot on screen makes
  the View load the log as it is on disk then, instead of showing the event from a changed log.

### Redaction

**DSH-10: Redaction**

- Given `ESTELA_REDACT` is not `0` in the environment `dsh` was started in,
- When the Estela View shows any part of a session (header, timeline, ledger, inspector text, Raw, Model saw,
  Compare) or an error message,
- Then the home directory and the token patterns listed in
  [Privacy](../guide/privacy.md#what-redaction-covers) are replaced, the same way the `estela` dev server replaces
  them.
- Given `ESTELA_REDACT=0` in that environment, the Estela View shows the recorded text unredacted.

### Theme and language

**DSH-11: Theme and language follow dsh**

- Given the user picks light, dark, or system in dsh's appearance settings, the Estela View uses that color scheme and
  adopts dsh's surface, border, text, accent, and font-family tokens, also when the setting changes while the View is
  open. The View has no theme switch.
- Given the user picks a language in dsh, the Estela View uses Simplified Chinese for Chinese and English for every
  other language, also when the language changes while the View is open. The View has no language switch.
- Session content is shown as recorded in both languages.

### Uninstalling

**DSH-12: Uninstalling leaves nothing behind**

- Given the plugin is installed and `dsh web` is running,
- When the user runs `dsh plugin --profile web remove @rivus/dsh-estela`,
- Then within a few seconds the Estela tab disappears from the open page without a restart, and a call to the
  plugin's channel is refused.
- And nothing of the plugin remains: no process (it starts none), no listening port, no route on dsh's HTTP
  server, and no entry in the profile's `package.json` or `node_modules`.
- And installing the plugin again works.

### dsh version outside the supported range

- The supported dsh versions are the range in the plugin's `engines.dsh` field.

**DSH-13: A dsh version outside `engines.dsh`**

- Given the running dsh is outside that range,
- When the user runs the install command,
- Then dsh refuses before anything is installed, exits with status 1, and prints on stderr that the plugin is
  incompatible with the running dsh version, which requirement is not met, and `dsh plugin allow-version` as the way
  to accept the risk for one exact plugin version on one exact dsh version.
- Given the plugin is already in the profile and dsh is outside the range (dsh was upgraded or downgraded),
- When the profile starts,
- Then dsh starts without the plugin, prints one line on stderr saying that it disabled the plugin and why, and
  `dsh web` shows no Estela tab.

### Who may read a session

**DSH-14: Only dsh's owner gets session content**

- The plugin's channel is protected by dsh's own admission, which the plugin does not replace:
  a request without dsh's cookie is refused (401), and a request with the cookie but from another origin or another
  `Host` is refused (403).
- Given a peer that dsh admitted as its owner, by the browser cookie or by the API cookie that dsh's start URL
  issues, When it calls the plugin's channel, Then it is served.
- Given a peer whose principal is not `owner`, When it reaches the plugin's channel, Then the plugin refuses the
  call and returns no session content.

## Domain Invariants

- The plugin reads the log of the session dsh shows, from disk, through the same dsh reader the `estela` command
  line uses. Everything the View draws is computed in the browser from that log, as the command line's workspace
  does.
- The plugin writes nothing to disk: not to the session log, not to dsh's files, and not to Estela's session index.
- Missing data is `unavailable`. Nothing is estimated or invented.
- The id the browser uses for a loaded log is opaque. A path or a dsh session id cannot be read from it, and a path
  never crosses the channel as an id.
- Session content is data. It is drawn as text, never as markup.
- No message the plugin itself creates holds a path; a message that can hold one comes from the store, which
  redacts it.
- A loaded View is a snapshot of the log at one moment.

## Compatibility And Constraints

- Public API, covered from the plugin's first release: the package name; the install and remove commands; the tab
  labeled "Estela" beside Chat and Trajectory; the `engines.dsh` range; the effect of `ESTELA_REDACT=0`; and that
  the plugin has no configuration. Not covered: the plugin's channel and endpoint names, the `<estela-workspace>`
  element and its `source` property, the files inside the package, and the wording of notices.
- Persisted data: none.
- Configuration: none in this version.
- Operational bounds: the 12 MB view budget ([view trace](../architecture/overview.md#view-trace-loading-and-reconstruct));
  the last three opened snapshots stay in the memory of the dsh process; a compressed log is decompressed up to
  512 MB; the plugin runs in dsh's own Node.js process.
- Profiles: the `web` profile is supported. Other profiles (Desktop, TUI) are not verified and not supported.
- The plugin follows dsh's release candidate line. A dsh release outside `engines.dsh` needs a plugin release with
  a new range (decision D2 in the Plan).

## Acceptance Evidence

`dsh.smoke.ts` is `apps/dsh-plugin/test/dsh.smoke.ts`: it packs the plugin, installs it into a temporary `DSH_HOME`
with a pinned dsh, starts `dsh web` without calling a model, and drives the page with Playwright.

| Scenario | Test |
|---|---|
| DSH-1 | `dsh.smoke.ts` (DSH-1) |
| DSH-2 | `dsh.smoke.ts` (DSH-2) on a session seeded from `fixtures/sessions/dsh/conformance/`; the workspace tests of the command line unchanged (S2, S7, CD-S1 in `apps/e2e`), which prove the workspace itself; S7 and CD-S1 again on the element (`apps/e2e/src/e2e/embed.e2e.ts`) |
| DSH-3 | `dsh.smoke.ts` (DSH-3) on a new session |
| DSH-4 | `apps/dsh-plugin/src/host/channel.test.ts` (DSH-4); `apps/web/src/embed/estela-workspace.test.ts` |
| DSH-5 | `apps/dsh-plugin/src/host/channel.test.ts` (DSH-5) with the unreadable and unknown-generation dsh fixtures and with dsh's own format refusal; `apps/web/src/embed/estela-workspace.test.ts` for the hint, the link, and the missing back link |
| DSH-6 | `apps/e2e/src/e2e/embed.e2e.ts` with a source that throws and with one that refuses once; `dsh.smoke.ts` (DSH-6): a transport failure while the View is mounted |
| DSH-7 | `apps/web/src/embed/estela-workspace.test.ts` with a slow source; `dsh.smoke.ts` (DSH-7) records N |
| DSH-8 | `packages/kernel/src/view.test.ts` (`fitView`, existing); the measurement recorded in the Plan that a 12 MB result crosses dsh's channel |
| DSH-9 | `apps/dsh-plugin/src/host/sessions.test.ts` (DSH-9): a changed log gets a new id and is read again; an evicted snapshot whose file changed is refused as stale |
| DSH-10 | `apps/dsh-plugin/src/host/channel.test.ts` (DSH-10), both values of `ESTELA_REDACT`; `dsh.smoke.ts` (DSH-10) on a seeded session whose text holds the temporary home path |
| DSH-11 | `apps/web/src/embed/estela-workspace.test.ts` (the attributes); `apps/dsh-plugin/src/client/appearance.test.ts`; `dsh.smoke.ts` (DSH-11) |
| DSH-12 | `dsh.smoke.ts` (DSH-12): the listening sockets of the dsh process are the same before and after |
| DSH-13 | `apps/dsh-plugin/src/package.test.ts` (the range starts at the tested dsh); `dsh.smoke.ts` (DSH-13): a repacked tarball with an unsatisfiable range is refused, and a profile whose installed copy declares that range starts without the tab |
| DSH-14 | `apps/dsh-plugin/src/host/channel.test.ts` (a peer that is not the owner); `dsh.smoke.ts` (DSH-14): no cookie is 401, another origin is 403 |
