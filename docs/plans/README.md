# Implementation Plans

A plan records the technical decisions and the detailed execution plan for one deliverable. The Spec says what behavior is required; the plan says how it is built and exactly what the implementer does, in order. Product work pairs a plan with one behavioral Spec. A technical refactor may use a plan alone.

Each plan has a Chinese reading copy; see [Bilingual Documentation](../../CONTRIBUTING.md#bilingual-documentation).

Active plans:

- [0010: Estela as a dsh plugin](0010-dsh-plugin.md) (in review), paired with its [Spec](../specs/0010-dsh-plugin.md).

Delivered plans were retired after their lasting constraints moved into the [architecture overview](../architecture/overview.md), [`AGENTS.md`](../../AGENTS.md), the [public interface](../reference/public-interface.md), and the tests. Git history keeps the retired files.

Start from [`0000-template.md`](0000-template.md). Keep only the sections the change needs: background, outline, detailed design, rollout, verification, and the execution plan. Delete the rest. The execution plan lists preconditions, a completion contract, ordered tasks with files, changes, tests, and exit conditions, a validation ledger, and rollback per batch. Keep a plan `blocked` while a material decision is unresolved. Unknown owners and dates stay "unconfirmed".

The design sections match the `technical-design-docs` skill. Install that skill for writing and review rules. This repository does not copy those rules.

Shared decisions follow [CONTRIBUTING](../../CONTRIBUTING.md#change-design-gate). At completion, move lasting constraints into current-state docs and tests, then delete the finished Spec and plan in the final delivery PR. Keep unfinished scope. Follow the [SDD lifecycle](../../CONTRIBUTING.md#sdd-workflow-and-document-lifecycle).
