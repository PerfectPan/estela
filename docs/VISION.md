# Agent Trace — vision for reviewers

Read-only. Do not modify files. Do not run git. Do not `find /`.

This is the lead (Grok) design for a **generic agent-trace viewer DevTool**. The empty repo is `/Users/bytedance/Workspace/agent-trace`. Refs: `/tmp/agent-trace-research/devframe`, `/tmp/agent-trace-research/deepseek-harness`.

## Product

Local-first inspect tool. Not a harness, not dsh's Trajectory tab, not RCA, not dataset publishing.

**Session** = the durable archive (append-only events).  
**Trajectory** = one projection of that archive (the step-by-step path).  
We store session-shaped `events[]`. Turn/step/tree are folds.

**Killer feature:** at any event, reconstruct **what the model actually saw** (system / tools / messages after compaction), vs the full ledger of what happened. Missing fields are `unavailable`, never invented. Same function is an MCP tool.

## Architecture

```
adapters (dsh JSONL/zstd/ZIP, Claude Code JSONL)
        │  ingest only
        ▼
canonical Trace = events[] + original
        │
kernel (ZERO devframe imports): load, fold, reconstruct, redact, exportJSON
        │
DevFrame shell: listTraces + getTrace + reconstruct as query+snapshot RPC/MCP
        │
        ├─ npx agent-trace [path]     local SPA
        ├─ agent-trace build          redacted static HTML
        └─ agent-trace mcp            other agents call reconstruct
```

Hard rules:

1. UI / RPC / MCP / static dump only see canonical Trace.
2. Do not invent boundaries (Claude Code has no `step/start`; it is a `parentUuid` tree + sidechains).
3. Keep `original` on every event.
4. Compaction / summary / surface-replace must be representable (`shadowedBy`) on day one.
5. DevFrame streaming is not the session SoT (client highWaterMark can drop chunks). v1 has no live follow.
6. `getTrace` is one blob. No `pageEvents`. Static `createBuild` only bakes `static`/`query` snapshots.

v1 adapters: **dsh** (richest; default disk is zstd frames, use format catalog, fail loud on unknown generation) + **Claude Code** (breaks linear schema). Codex later.

Out of v1: rewrite Trajectory, embed in `dsh web`, Electron, hub docks, streaming, shared-state, AgentDebugX-style diagnose/rerun.

## Why DevFrame

Only the shell: localhost HTTP + birpc + OTP + `createBuild` dump + MCP from the same RPCs. Kernel stays portable. Without it we still have schema/adapters; we lose the three distribution paths (or rebuild them).

## Community (do not clone these)

- dsh Trajectory: product tab on Cordis + own session follow.
- ezra-y/agent-trajectory: clones that UI for Claude/Codex → static HTML. Closest cousin. No MCP, no dsh, no reconstruct.
- ccx / agents-tracer / agent-trail: history browsers.
- cctrace: TLS intercept of the live HTTP request (reconstruct by tapping the wire). Opposite ingest.
- AgentDebugX: diagnose/rerun. opentraces: capture + HF datasets. Langfuse/Phoenix: OTel platforms.
- Cursor Agent Trace spec (agent-trace.dev): git blame attribution, not a session viewer.

Nobody ships this on DevFrame.

## Questions

1. Is the killer (reconstruct model-visible context at event E) the right v1 bet vs a better ledger?
2. Event-sourced kernel vs storing turns/steps?
3. DevFrame as thin shell: keep, or skip and ship SPA + static HTML only?
4. First adapters dsh + Claude Code — agree?
5. What would you cut or add to a cold-start repo this week?

## Output contract

Final message only:

```
VERDICT | SHIP AS PROPOSED | SHIP WITH CHANGES: … | DON'T USE DEVFRAME | WRONG PRODUCT
AGREE | bullets
DISSENT | bullets
CHANGE | bullets
RISK | bullets
CUT | bullets
ADD | bullets
```

1–4 bullets per field. Cite files you opened. No file edits.
