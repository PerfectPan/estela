---
"@rivus/agent-trace": minor
---

Switch the ledger to a lane layout. A toggle in the ledger bar ("轮次 / 代理", "Turns / Agents") redraws the ledger with one header per agent lane — the main lane first, then each subagent in `projectLanes` order — and the lane's own events flat under it, so one agent's lane reads on its own instead of sitting behind its spawn call. The lane rows share the turn layout's entries, so one event keeps one row identity across both layouts, the kind chips and the brush range apply either way, collapse keys are disjoint (`l:<agent>` against `t<index>`), the keyboard falls back to the lane header the way it falls back to the turn header, and reveal from a timeline bar opens the event's lane the same way it opens its turn. The turn layout stays the default.

Mouse and keyboard lane collapse share the same state. Switching layouts preserves visible selection, hook groups from later turns remain available, and long lanes render without exceeding the JavaScript argument limit. Spawn calls participate in Tools and Failures filtering in either layout.
