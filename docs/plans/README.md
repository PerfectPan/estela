# Implementation Plans

A plan records the technical decisions and the detailed execution plan for one deliverable. The Spec says what behavior is required; the plan says how it is built and exactly what the implementer does, in order. Product work pairs a plan with one behavioral Spec. A technical refactor may use a plan alone.

Each plan has a Chinese reading copy; see [Bilingual Specs And Plans](../../CONTRIBUTING.md#bilingual-specs-and-plans).

Active plans: [`0003-cli-layers.md`](0003-cli-layers.md), [`0004-rebrand-estela.md`](0004-rebrand-estela.md), [`0006-server-composition.md`](0006-server-composition.md), [`0008-cost.md`](0008-cost.md), and [`0009-mcp-tools.md`](0009-mcp-tools.md). [`0002-export-atif-otlp.md`](0002-export-atif-otlp.md) was delivered in #68 and still waits to be retired with its Spec.

Start from [`0000-template.md`](0000-template.md). Keep only the sections the change needs: background, outline, detailed design, rollout, verification, and the execution plan. Delete the rest. The execution plan lists preconditions, a completion contract, ordered tasks with files, changes, tests, and exit conditions, a validation ledger, and rollback per batch. Keep a plan `blocked` while a material decision is unresolved. Unknown owners and dates stay "unconfirmed".

The design sections match the `technical-design-docs` skill. Install that skill for writing and review rules. This repository does not copy those rules.

Shared decisions follow [CONTRIBUTING](../../CONTRIBUTING.md#change-design-gate). At completion, move lasting constraints into current-state docs and tests, then delete the finished Spec and plan in the final delivery PR. Keep unfinished scope. Follow the [SDD lifecycle](../../CONTRIBUTING.md#sdd-workflow-and-document-lifecycle).
