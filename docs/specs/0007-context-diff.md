# Spec 0007: Context diff between two requests

## Status

Draft

Paired Plan: [`docs/plans/0007-context-diff.md`](../plans/0007-context-diff.md)

## Problem And Scope

"Model saw" answers what one request's context held: the slots `reconstruct`
returns (system prompt, tools, summary, messages, this turn), each `present`,
`empty`, or `unavailable`, the events a compaction removed, and the token
counts the agent recorded. Two questions need more than one request
([#102](https://github.com/PerfectPan/agent-trace/issues/102)):

1. What changed between two requests: which events entered the context,
   which left it, which a compaction hid, and whether the system prompt or
   the tool list changed. The common cases are the requests on either side
   of a compaction and two neighboring requests.
2. Where the tokens went over the session, slot by slot.

This Spec adds a context diff of two requests on the same lane, in the
workspace inspector, on the dev server and in a report. It answers the
second question only as far as the logs allow; see
[Composition over time](#composition-over-time).

Excluded: MCP tools, cost, any change in `@rivus/agent-kit`, exports (ATIF,
OTLP, report contents), a diff of two sessions, and a diff of message text.

## Behavioral Requirements

- The inspector has a Compare tab between Model saw and Raw. When the
  selected event is a request, the tab compares it with another request of
  the same lane.
- The comparison target is, in order of precedence: the request the user
  picked, while it is still a request of the selected request's lane other
  than the selected one; otherwise the previous request on that lane; for the
  first request of a lane, the next one.
- The user picks the target in three ways: a picker listing every other
  request of the lane (with its recorded input tokens, or "not recorded"); a
  "Previous request" quick pick; and Shift-click on a request bar of the
  timeline's main lane. A "Before the last compaction" quick pick appears
  when a compaction precedes the selected request on its lane; it picks the
  last request of the lane before that compaction.
- Model saw on a request links to the Compare tab.
- The diff always runs from the earlier request to the later one, whichever
  of the two is selected; the selected one is marked.
- The diff shows:
  - the two requests' recorded input tokens and their difference, only when
    both are recorded; otherwise a line saying no difference is shown;
  - each compaction of the lane between the two requests, with its recorded
    pre → post tokens or "not recorded";
  - per slot: for the system prompt, "same" or "changed"; for the tools,
    "same", the tool names added and removed, or "changed · tool names not
    recorded" when a definition carries no name; for summary, messages, and
    this turn, the number of events added, removed, and kept, plus the slot's
    status change (for example empty → present);
  - the events that entered the context (in a slot after, in no slot
    before), each selectable;
  - the events a compaction between the two requests hid, struck through as
    in Model saw, each selectable.
- A slot either request's log does not record is drawn hatched and labeled
  "unavailable", and no change is listed for it.
- The tab states that slot counts are events, not tokens.
- The timeline draws the compared request with a dashed ring while the
  Compare tab is open, beside the selected request's solid ring.
- Event kind stays a mark; no diff text uses the error color.

## Domain Invariants

- The diff is computed from two `reconstruct` results on the same trace (the
  view trace in the browser); it inherits every `reconstruct` rule: the
  lane-scoped prefix, `shadowedBy`, prompt snapshots, and `unavailable` for
  what the log does not record.
- The events the diff lists as hidden by compaction are exactly the events
  whose `shadowedBy` compaction lies in the later request's prefix and not in
  the earlier one's.
- Token numbers are recorded numbers only: each request's
  `request.inputTokens` and each compaction's `preTokens` / `postTokens`. No
  slot is given a token count, and no delta is computed from a missing
  number.
- The system prompt and tool list are compared by content. A view trace
  replaces a repeated value with a reference to the snapshot that holds it;
  the comparison follows the reference, and two values the view shortened
  are never called equal by their shortened text.
- Each lane is its own model conversation. Two events on different lanes are
  not compared; the kernel rejects the pair with that reason.

## Composition Over Time

Agents record one input-token total per request and, at a compaction, the
tokens before and after it. They do not record how those tokens split
between the system prompt, tools, summary, and messages. A per-slot token
composition over time would have to be estimated from text length, which
this product does not do.

What can be shown honestly is already shown: the recorded totals over time
are the timeline's bar heights, and each compaction's pre → post is its
label. Event counts per slot are not a measure of tokens (one tool result can
outweigh a hundred messages), and a chart of them over time next to the token
bars would be read as a token split. The diff therefore shows event counts
per slot only between two chosen requests, labeled as events, beside the
recorded totals. A composition-over-time view is left out of this Spec.

## Acceptance Examples

### CD-S1: Compare across a compaction

Given a Claude Code session with three requests, an automatic compaction
(pre 3.5k, post 400), and two more requests,
When the user selects the first request after the compaction and opens
Compare,
Then the target is the last request before the compaction, the diff shows
"3k → 600" and "−2.4k input tokens", one compaction row "3.5k → 400", the
compaction summary among the events that entered, and as many events hidden
by compaction as Model saw lists as dropped.

### CD-S2: Before the last compaction

Given the same session,
When the user selects the last request and opens Compare,
Then the target is the previous request (600 → 900) with no compaction and
no hidden events; after "Before the last compaction" the target is the 3k
request and one compaction row appears.

### CD-S3: Pick from the timeline

Given Compare open on a request,
When the user Shift-clicks another request bar of the main lane,
Then that request becomes the target, the timeline draws it with a dashed
ring, and the selection does not move.

### CD-S4: Missing data stays missing

Given a session whose log records no system prompt or tool list,
When two requests are compared,
Then the system prompt and tools rows are hatched and "unavailable" with no
change listed; and when either request has no recorded input tokens, no
difference is shown.

### CD-S5: Prompt snapshots

Given a session with prompt snapshots,
When two requests under the same recorded system prompt are compared,
Then the system prompt is "same", on the full trace and on the view trace
alike; when the tool list changes, the added and removed tool names are
listed; when a tool definition carries no name, the tools row says the
names are not recorded; when the tool list was first recorded after the
earlier request, the tools row is "unavailable".

### CD-S6: Same request

Given any request,
When the kernel diffs it with itself,
Then nothing entered, left, or was hidden, every slot lists no added or
removed events, and the input-token delta is 0 when the count is recorded.

### CD-S7: Report mode and Chinese

Given a report built with `estela build` from a session with a compaction,
opened from `file://`,
When the user opens Compare on a request after the compaction and switches
to Chinese,
Then the diff is the same as on the dev server and every label is Chinese.

### CD-S8: Lanes

Given a session with a subagent,
When two requests of the subagent lane are compared,
Then the diff covers only that lane's events; the picker never offers a
request of another lane, and the kernel rejects a pair on different lanes
with the reason `different-lanes`.

### CD-S9: Nothing to compare

Given the selected event is not a request, or its lane has no other request,
When the user opens Compare,
Then the tab says so in one line and shows no diff.

## Compatibility And Constraints

- Works the same on the dev server and in a report: the diff runs in the
  browser on the view trace, with no new RPC.
- No change to the CLI commands, the canonical trace format, the RPC
  contracts, or the report contents.
- UI strings are in English and Simplified Chinese.

## Acceptance Evidence

| Scenario | Evidence |
|---|---|
| CD-S1 | `packages/kernel/src/context-diff.test.ts` (compaction case); `apps/e2e/src/e2e/compare.e2e.ts` "CD-S1, CD-S4" |
| CD-S2 | `apps/web/src/lib/context-compare.test.ts`; `compare.e2e.ts` "CD-S2, CD-S3" |
| CD-S3 | `compare.e2e.ts` "CD-S2, CD-S3" |
| CD-S4 | `context-diff.test.ts` (unavailable slots, subagent delta); `compare.e2e.ts` "CD-S1, CD-S4" |
| CD-S5 | `context-diff.test.ts` (content and view trace, cut prompts); `compare.e2e.ts` "CD-S5" |
| CD-S6 | `context-diff.test.ts` (same request) |
| CD-S7 | `compare.e2e.ts` "CD-S7" |
| CD-S8 | `context-diff.test.ts` (subagent lane, rejection); `context-compare.test.ts` (subagent lane) |
| CD-S9 | `context-compare.test.ts` (no options for a non-request) |
