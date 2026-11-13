# Plan 0007: Context diff between two requests

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-13
- Paired Spec: [`docs/specs/0007-context-diff.md`](../specs/0007-context-diff.md)

This plan adds a pure kernel diff of two `reconstruct` results and a Compare
tab in the workspace inspector that draws it. It follows issue #102.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Rollout and stability
5. Verification
6. Execution plan
7. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- `reconstruct(trace, eventId)` (`packages/kernel/src/reconstruct.ts`)
  returns, for one event on its lane: `visibleIds`, `removedIds` (events a
  compaction in the prefix hid through `shadowedBy`), five slots with
  `present` / `empty` / `unavailable` and their event ids, `recordedBy` for
  the system prompt and tools when they come from a prompt snapshot, and
  `tokens[]` with the recorded counts.
- The browser runs `reconstruct` on the view trace, on the dev server and in
  a report. The view keeps each distinct snapshot system prompt and non-empty
  tool list once and replaces a repeat with `systemPromptSameAs` /
  `toolsSameAs`, compared on the full values before any cap.
- Tool definitions are `unknown[]` in the kit's `PromptSnapshotPayload`. The
  kit's adapters record two shapes: `{ name, … }` (Claude Code) and
  `{ type: 'function', function: { name } }` (Grok).
- The inspector's tab state is local to `inspector.tsx`; the timeline selects
  a main-lane request on click.

### 1.2 Problem

The user can see one request's context, not what changed between two, which
is the question a compaction raises.

### 1.3 Goals and success criteria

- A kernel function that diffs two events of one lane with the `reconstruct`
  rules and no estimate.
- A Compare tab with a target picker, the quick picks, Shift-click on the
  timeline, and the diff view; Spec CD-S1 to CD-S9 pass.

### 1.4 Non-goals

MCP tools, cost, `@rivus/agent-kit` changes, exports, a composition-over-time
chart (Spec, Composition Over Time), and a text diff of message content.

## 2. Outline

### 2.1 Design principles

- The diff is a function of two `reconstruct` results; it adds no context
  rule of its own.
- Missing data stays missing: a slot `unavailable` on either side is not
  compared; a token delta needs both recorded counts.
- The UI computes everything in the browser from the view trace, so the
  report needs nothing new.

### 2.2 Boundaries and responsibilities

| Layer | Owns |
|---|---|
| `packages/kernel` `context-diff.ts` | `diffContext` and its result types; tool-name parsing with a `zod/mini` schema at the boundary of `unknown` tool definitions |
| `apps/web` `lib/context-compare.ts` | which requests can be compared with the selected one, the previous one, the one before the last compaction, and the effective target |
| `apps/web` `workspace/workspace-state.ts` | the inspector tab and the user's compare pick, shared by the timeline and the inspector |
| `apps/web` `workspace/inspector/` | the Compare tab components (`context-compare.tsx`, `compare-body.tsx`, `compare-slot-row.tsx`, `compare-event-list.tsx`) and shared slot styling (`slot-style.ts`) |
| `apps/web` `workspace/timeline/` | Shift-click to compare; the dashed ring on the compared bar |

## 3. Detailed design

### 3.1 Entry points

- Inspector tab "Compare" (`inspector-tab.ts` lists the tabs).
- Model saw on a request: a "Compare with another request" link that opens
  the tab.
- Timeline: Shift-click on a main-lane request bar while another request is
  selected calls `compareWith(id)`, which sets the pick and opens the tab.

### 3.2 Kernel interface

```ts
diffContext(trace: Trace, firstId: string, secondId: string): ContextDiff

type ContextDiff = ContextDiffResult | ContextDiffRejection

type ContextDiffRejection =
  | { status: 'rejected'; reason: 'event-not-found'; missing: string[] }
  | { status: 'rejected'; reason: 'different-lanes'; lanes: [string, string] }

interface ContextDiffResult {
  status: 'compared'
  lane: string
  beforeId: string // earlier in trace order
  afterId: string
  compactionIds: string[] // lane compactions after beforeId, up to afterId
  entered: string[] // in a slot after, in no slot before
  left: string[] // in a slot before, in no slot after
  compacted: string[] // after.removedIds minus before.removedIds
  slots: SlotDiff[]
  system: { change: 'unavailable' } | { change: 'same' | 'changed' }
  tools:
    | { change: 'unavailable' }
    | { change: 'same' }
    | { change: 'changed'; added: string[] | undefined; removed: string[] | undefined }
  inputTokens: { before: number | undefined; after: number | undefined; delta: number | undefined }
}

type SlotDiff =
  | { name; change: 'unavailable'; before; after }
  | { name; change: 'compared'; before; after; added: string[]; removed: string[]; unchanged: string[] }
```

Decisions:

- D1. Order: the two ids are sorted by trace position, so the diff always
  runs forward and `compacted` keeps its meaning. Passing the same id twice
  gives an empty diff.
- D2. Lanes: a pair on different lanes is rejected with
  `different-lanes`. Each lane's `reconstruct` sees only its own events, so a
  cross-lane diff would list every event as entered and left, which says
  nothing true about either model call.
- D3. `compacted` is `after.removedIds` minus `before.removedIds`: exactly
  the events whose `shadowedBy` compaction entered the prefix between the
  two. It also includes hidden events that were in no slot at the earlier
  request: records outside the slots (requests, prompt snapshots, hooks,
  the earlier request itself) and events that came after it; `left` is the
  subset that was in a slot.
- D4. Per-slot ids are compared as sets per slot. An event that moves
  between slots (a finished turn moves from `currentTurn` to `messages`)
  counts as removed from one slot and added to another, but not as entered
  or left; the UI states this.
- D5. System prompt and tools: without prompt snapshots both sides come
  from the same session or lane field, so they are `same` when recorded.
  With snapshots, each side resolves `recordedBy` through
  `systemPromptSameAs` / `toolsSameAs` to the snapshot holding the value.
  The same holder is `same`. Different holders compare their values, unless
  either value is listed in the snapshot's `$truncated` (the view cut it);
  then they are `changed`, because the view only keeps two holders when
  their full values differ.
- D6. Tool names: each definition is parsed with
  `z.union([z.object({ name: z.string() }), z.object({ function: z.object({ name: z.string() }) })])`.
  If any definition on either side fails, `added` and `removed` are
  `undefined` and the UI says the names are not recorded.
- D7. Tokens: only `request.inputTokens` from each `reconstruct`; the delta
  is `undefined` unless both are recorded. Compactions' pre/post are read by
  the UI from the compaction events listed in `compactionIds`.
- D8. Kernel depends on `zod` (catalog) for D6, as `schema` does; the
  browser bundle check bundles it.

### 3.3 Web model

`compareChoices(model, eventId)` returns the other requests of the selected
request's lane (from `LedgerModel.requests`), the previous request, and the
last request before the latest lane compaction that precedes the selected
request (positions from `trace.events`). `compareTarget(choices, pick)`
keeps the pick while it is an option, else takes the previous request, else
the first option (the next request). Non-request events have no options.

### 3.4 UI

- `WorkspaceState` gains `tab` / `setTab` (moved from the inspector), and
  `comparePick` / `compareWith(id)`. The inspector builds a panel the first
  time its tab shows, also when the timeline opened it.
- Compare tab layout, top to bottom: "Compared with" and a native `select`;
  quick-pick chips styled like the ledger chips, and a hint about
  Shift-click; the two request names with the selected one marked; recorded
  input tokens `before → after` and the signed delta in neutral text, or a
  line saying no difference is shown; one dashed neutral rule per compaction
  between them with pre → post; "Changes by slot" rows with the slot square
  (hatched when unavailable, outlined when empty), and the change text
  (`same` / `changed` / tool names / `+N · −M · K kept`, zero parts omitted,
  status change in subtle text); a note that counts are events, not tokens;
  "Entered the context" and "Hidden by compaction" (struck through), four
  rows then "Show all", up to 300; a compaction row in a list reads
  "Compaction · pre → post".
- Timeline: `MainLane` draws the compared bar with a dashed ring in
  `--muted-foreground` while the Compare tab is open.
- Strings: a `compare` section and `inspector.compare` in both
  dictionaries; the timeline's aria label mentions Shift-click.

### 3.5 Failures and recovery

Rejections cannot come from the picker (it lists one lane), but the tab
shows one line for a rejected pair. A non-request selection and a lane with
one request each show one line. Nothing is persisted.

### 3.6 Compatibility and migration

No change to commands, the canonical format, RPC, or reports. The kernel
gains an export; the workspace packages' exports are not stable.

## 4. Rollout and stability

Ships in the next minor version. Rollback is reverting the PR.

## 5. Verification

- Kernel: `context-diff.test.ts` — the compaction case lists exactly the
  `shadowedBy` events, order independence, same request, unavailable slots,
  subagent lane with an unrecorded count, rejections, content comparison on
  the full and view trace, and prompts the view cut.
- Web: `context-compare.test.ts` — options, quick picks, subagent lane,
  non-request events, and the target fallback.
- E2E: `apps/e2e/src/e2e/compare.e2e.ts` — CD-S1 to CD-S5 and CD-S7 against
  the packed CLI, including a report from `file://`.
- Screenshots of the tab in dark, light, and Chinese, checked by eye.

### 5.1 Validation ledger

| Batch | Command or evidence | Expected result |
|---|---|---|
| kernel | `pnpm --filter @rivus/estela-kernel test` | diff tests green |
| web | `pnpm --filter @rivus/estela-web test` | model and dictionary tests green |
| e2e | `cd apps/e2e && pnpm run test:smoke`, `pnpm run test:e2e` | green, compare scenarios included |
| docs | `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-release-plan.mjs` | ok |
| gates | `node scripts/format.mjs --check`, `node scripts/lint-scripts.mjs`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | all green |

## 6. Execution plan

### 6.1 Preconditions

Paired Spec reviewed.

### 6.2 Completion contract

CD-S1 to CD-S9 have the evidence the Spec lists; README, overview, and the
changeset updated; all gates green.

### 6.3 Execution order

1. Kernel: `context-diff.ts`, its test, the `index.ts` export, `zod` in the
   kernel's dependencies.
2. Web model: `lib/context-compare.ts` and its test.
3. Web state and UI: `workspace-state.ts`, `inspector-tab.ts`,
   `slot-style.ts` (shared with Model saw), the four Compare components,
   the Model saw link, the timeline Shift-click and ring, dictionaries.
4. E2E: `compare.e2e.ts`.
5. Docs: README and `README.zh-CN.md` Features, the architecture overview,
   the Spec and Plan READMEs; changeset.
6. Gates and screenshots.

### 6.4 Rollback per batch

Each batch reverts on its own; batch 3 depends on 1 and 2, batch 4 on 3.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step |
|---|---|---|---|---|
| A new agent records tool definitions in a third shape | risk | Tool names show as not recorded | unconfirmed | Add the shape to the D6 schema |
| Timeline Shift-click only reaches the main lane | follow-up | Subagent requests are compared through the picker only | unconfirmed | Add subagent bars if users ask |
| MCP tool for the diff | follow-up | Agents cannot ask for a diff | unconfirmed | Separate change, out of this scope |
| Composition over time | follow-up | No per-slot token view | unconfirmed | Revisit only if an agent records per-slot counts |
