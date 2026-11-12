> 中文阅读版。以英文原文 docs/plans/0007-context-diff.md 为准。

# Plan 0007: 两个请求之间的上下文差异

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-13
- Paired Spec: [`docs/specs/0007-context-diff.md`](../specs/0007-context-diff.md)

本计划加入一个对两次 `reconstruct` 结果做差异的纯 kernel 函数，以及工作区检查器中画出该差异的"对比"标签页。对应 issue #102。

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

- `reconstruct(trace, eventId)`（`packages/kernel/src/reconstruct.ts`）对其通道上的一个事件返回：`visibleIds`、`removedIds`（前缀中的压缩通过 `shadowedBy` 隐藏的事件）、五个槽位及其 `present` / `empty` / `unavailable` 与事件 id、系统提示词和工具来自 prompt 快照时的 `recordedBy`，以及记录的 token 数 `tokens[]`。
- 浏览器在视图 trace 上运行 `reconstruct`，开发服务器和报告都如此。视图对每个不同的快照系统提示词和非空工具列表只保留一次，重复的值替换为 `systemPromptSameAs` / `toolsSameAs`，比较基于截短前的完整值。
- 在 kit 的 `PromptSnapshotPayload` 中，工具定义是 `unknown[]`。kit 的适配器记录两种形状：`{ name, … }`（Claude Code）和 `{ type: 'function', function: { name } }`（Grok）。
- 检查器的标签页状态只存在于 `inspector.tsx` 内；时间线点击时选中主通道的请求。

### 1.2 Problem

用户能看到一个请求的上下文，看不到两个请求之间的变化，而这正是压缩带来的问题。

### 1.3 Goals and success criteria

- 一个 kernel 函数，按 `reconstruct` 的规则、不做估算，对同一通道的两个事件做差异。
- 一个"对比"标签页，包含对比对象选择框、快捷选项、时间线上 Shift 点击和差异视图；Spec CD-S1 到 CD-S9 通过。

### 1.4 Non-goals

MCP 工具、费用、`@rivus/agent-kit` 改动、导出、随时间变化的构成图（见 Spec 的 Composition Over Time）、消息内容的文本差异。

## 2. Outline

### 2.1 Design principles

- 差异是两次 `reconstruct` 结果的函数；它不增加自己的上下文规则。
- 缺失的数据保持缺失：任一侧为 `unavailable` 的槽位不做比较；token 差值需要两侧都有记录的数。
- 界面在浏览器中基于视图 trace 计算全部内容，报告无需新增任何东西。

### 2.2 Boundaries and responsibilities

| Layer | Owns |
|---|---|
| `packages/kernel` `context-diff.ts` | `diffContext` 及其结果类型；在 `unknown` 工具定义的边界用 `zod/mini` schema 解析工具名称 |
| `apps/web` `lib/context-compare.ts` | 哪些请求可与选中请求对比、上一个请求、最近一次压缩之前的请求，以及实际对比对象 |
| `apps/web` `workspace/workspace-state.ts` | 检查器标签页和用户的对比选择，由时间线和检查器共享 |
| `apps/web` `workspace/inspector/` | "对比"标签页组件（`context-compare.tsx`、`compare-body.tsx`、`compare-slot-row.tsx`、`compare-event-list.tsx`）和共享的槽位样式（`slot-style.ts`） |
| `apps/web` `workspace/timeline/` | Shift 点击对比；对比柱条的虚线框 |

## 3. Detailed design

### 3.1 Entry points

- 检查器标签页"对比"（`inspector-tab.ts` 列出各标签页）。
- 请求的"模型所见"：一个"与另一个请求对比"链接，打开该标签页。
- 时间线：在已选中另一个请求时按住 Shift 点击主通道请求柱条，调用 `compareWith(id)`，设置选择并打开该标签页。

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

决定：

- D1. 顺序：两个 id 按 trace 位置排序，因此差异总是向后计算，`compacted` 的含义保持不变。同一个 id 传两次得到空差异。
- D2. 通道：位于不同通道的一对事件以 `different-lanes` 拒绝。每个通道的 `reconstruct` 只看到自己的事件，跨通道差异会把每个事件都列为进入和离开，对任何一次模型调用都不成立。
- D3. `compacted` 是 `after.removedIds` 减去 `before.removedIds`：正好是那些 `shadowedBy` 指向的压缩在两者之间进入前缀的事件。它还包含在较早请求处不在任何槽位中的被隐藏事件：槽位之外的记录（请求、prompt 快照、hook，以及较早请求本身）和发生在它之后的事件；`left` 是其中曾在槽位中的子集。
- D4. 每个槽位的 id 按集合比较。在槽位之间移动的事件（结束的轮次从 `currentTurn` 移到 `messages`）计为从一个槽位移除、加入另一个槽位，但不计为进入或离开；界面说明这一点。
- D5. 系统提示词和工具：没有 prompt 快照时，两侧来自同一个会话或通道字段，有记录时为 `same`。有快照时，每一侧通过 `systemPromptSameAs` / `toolsSameAs` 把 `recordedBy` 解析到持有该值的快照。同一个持有者为 `same`。不同持有者比较各自的值，除非任一值列在快照的 `$truncated` 中（视图截短了它）；此时为 `changed`，因为视图只在完整值不同时才保留两个持有者。
- D6. 工具名称：每个定义用 `z.union([z.object({ name: z.string() }), z.object({ function: z.object({ name: z.string() }) })])` 解析。任一侧有定义解析失败时，`added` 和 `removed` 为 `undefined`，界面说明未记录名称。
- D7. Token：只用每次 `reconstruct` 的 `request.inputTokens`；除非两者都有记录，差值为 `undefined`。压缩的压缩前/压缩后由界面从 `compactionIds` 列出的压缩事件读取。
- D8. kernel 为 D6 依赖 `zod`（catalog），与 `schema` 相同；浏览器包检查会把它打包进去。

### 3.3 Web model

`compareChoices(model, eventId)` 返回选中请求所在通道的其他请求（来自 `LedgerModel.requests`）、上一个请求，以及选中请求之前最近一次通道压缩之前的最后一个请求（位置来自 `trace.events`）。`compareTarget(choices, pick)` 在选择仍是选项之一时保留它，否则取上一个请求，再否则取第一个选项（下一个请求）。非请求事件没有选项。

### 3.4 UI

- `WorkspaceState` 增加 `tab` / `setTab`（从检查器移入）以及 `comparePick` / `compareWith(id)`。检查器在某个标签页第一次显示时构建它的面板，由时间线打开时也如此。
- "对比"标签页自上而下：“对比对象”和一个原生 `select`；样式与 ledger 筛选按钮相同的快捷选项，以及关于 Shift 点击的提示；两个请求的名称，选中的一个有标记；记录的输入 token `before → after` 和带符号的差值（中性文字色），或一行说明不显示差值；两者之间每次压缩一条中性虚线，带压缩前 → 压缩后；“各槽位的变化”各行，带槽位方块（不可用时斜线填充，空时只有边框）和变化文字（`same` / `changed` / 工具名称 / `+N · −M · K kept`，省略为零的部分，状态变化用次要文字色）；一条说明数量是事件数而非 token 数；“进入上下文”和“被压缩隐藏”（删除线），先显示四行再“显示全部”，最多 300 行；列表中的压缩行显示为 "Compaction · pre → post"。
- 时间线：“对比”标签页打开时，`MainLane` 用 `--muted-foreground` 虚线框画出对比柱条。
- 文字：两个词典都加入 `compare` 一节和 `inspector.compare`；时间线的 aria 标签提到 Shift 点击。

### 3.5 Failures and recovery

选择框只列出一个通道，因此不会产生拒绝，但标签页对被拒绝的一对显示一行说明。非请求的选中项和只有一个请求的通道各显示一行说明。不持久化任何内容。

### 3.6 Compatibility and migration

不改动命令、canonical 格式、RPC 或报告。kernel 新增一个导出；工作区各包的导出不稳定。

## 4. Rollout and stability

随下一个 minor 版本发布。回滚即回退该 PR。

## 5. Verification

- Kernel：`context-diff.test.ts`——压缩用例正好列出 `shadowedBy` 事件、顺序无关、同一个请求、不可用槽位、带未记录 token 的子代理通道、拒绝、完整 trace 与视图 trace 上的内容比较，以及视图截短的提示词。
- Web：`context-compare.test.ts`——选项、快捷选项、子代理通道、非请求事件和对比对象的回退。
- E2E：`apps/e2e/src/e2e/compare.e2e.ts`——针对打包的 CLI 运行 CD-S1 到 CD-S5 和 CD-S7，包括从 `file://` 打开的报告。
- 深色、浅色和中文下标签页的截图，人工检查。

### 5.1 Validation ledger

| Batch | Command or evidence | Expected result |
|---|---|---|
| kernel | `pnpm --filter @rivus/estela-kernel test` | 差异测试通过 |
| web | `pnpm --filter @rivus/estela-web test` | 模型和词典测试通过 |
| e2e | `cd apps/e2e && pnpm run test:smoke`、`pnpm run test:e2e` | 通过，包含对比场景 |
| docs | `node scripts/check-doc-translations.mjs`、`node scripts/check-conventions.mjs`、`node scripts/check-release-plan.mjs` | ok |
| gates | `node scripts/format.mjs --check`、`node scripts/lint-scripts.mjs`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`、`node scripts/check-layers.mjs`、`node scripts/check-browser-bundle.mjs` | 全部通过 |

## 6. Execution plan

### 6.1 Preconditions

配对的 Spec 已评审。

### 6.2 Completion contract

CD-S1 到 CD-S9 有 Spec 列出的证据；README、概览和 changeset 已更新；所有门禁通过。

### 6.3 Execution order

1. Kernel：`context-diff.ts`、它的测试、`index.ts` 导出、kernel 依赖中的 `zod`。
2. Web 模型：`lib/context-compare.ts` 及其测试。
3. Web 状态与界面：`workspace-state.ts`、`inspector-tab.ts`、`slot-style.ts`（与"模型所见"共享）、四个对比组件、"模型所见"中的链接、时间线 Shift 点击与虚线框、词典。
4. E2E：`compare.e2e.ts`。
5. 文档：README 和 `README.zh-CN.md` 的 Features、架构概览、Spec 和 Plan 的 README；changeset。
6. 门禁和截图。

### 6.4 Rollback per batch

每批可单独回退；第 3 批依赖第 1、2 批，第 4 批依赖第 3 批。

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step |
|---|---|---|---|---|
| 新的 agent 用第三种形状记录工具定义 | risk | 工具名称显示为未记录 | unconfirmed | 把该形状加入 D6 的 schema |
| 时间线 Shift 点击只覆盖主通道 | follow-up | 子代理请求只能通过选择框对比 | unconfirmed | 有需求时加入子代理柱条 |
| 差异的 MCP 工具 | follow-up | agent 无法请求差异 | unconfirmed | 单独变更，不在本范围内 |
| 随时间变化的构成 | follow-up | 没有按槽位的 token 视图 | unconfirmed | 仅当某个 agent 记录按槽位的数时再考虑 |
