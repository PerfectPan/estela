> 中文阅读版。以英文原文 docs/plans/0004-rebrand-estela.md 为准。

# Plan 0004: 项目从 agent-trace 更名为 Estela

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-12
- Paired Spec: none（不改变行为的更名；issue #89，roadmap #88）

本计划在一个 PR 中把产品名、发布的包、命令、工作区包、环境变量、缓存目录和格式标识从 agent-trace
改为 Estela。行为不变。

## Contents

1. 背景与目标
2. 概要
3. 详细设计
4. 发布与稳定性
5. 验证
6. 执行计划
7. 风险、待定问题与后续事项

## 1. 背景与目标

### 1.1 现状与约束

- 产品名为 agent-trace。唯一发布的包是 `@rivus/agent-trace`（bin 为 `agent-trace`，只发布过一次
  `0.1.0`）；工作区包为 `@rivus/agent-trace-<x>`，都打包进它。
- 名称也出现在数据标识中：canonical trace 的 `schema: 'agent-trace'`、ATIF `extra.agent_trace`、
  DevFrame id、RPC 命名空间和共享状态 `agent-trace:sessions`、MCP 工具前缀、开发服务器路径
  `/__agent-trace/`、默认导出文件名、报告临时目录、localStorage 键，以及缓存目录 `rivus-agent-trace`。
- 项目处于 0.x，没有外部用户。`@rivus/agent-kit` 是另一个包，保留原名。

### 1.2 问题

"Agent Trace" 也是 Cursor 一种代码归属格式的名称，因此 README 需要附带免责声明，搜索这个名字会
找到另一个项目。

### 1.3 目标与验收标准

- 3.1 中的每一类标识都使用新名称。
- `git grep -i -E "agent[-_ ]?trace"` 只找到 3.2 中保留的历史记录。
- 6.4 中的每项检查都通过。

### 1.4 非目标

- 不改变行为，不重构，不修复无关的过时文档。
- Logo 图形保持不变。
- 不兼容读取旧名称（3.3）。

## 2. 概要

### 2.1 设计原则

- 一个 PR 改完所有类别，不出现新旧名称混用的状态。
- 历史记录保持原样。

### 2.2 边界与职责

更名涉及每个工作区包、根目录脚本、CI workflow、`renovate.json`、`.changeset/`
以及文档。GitHub 仓库改名和 npm 相关工作由所有者负责（第 7 节）。

### 2.3 主路径

对已跟踪文件按类别逐一做脚本替换，再手工调整正文中产品名的大小写，最后用 `pnpm install` 刷新
lockfile。

### 2.4 设计决策

| ID | 决策 | 备选方案与理由 |
| --- | --- | --- |
| D1 | 正文和 UI 文案中产品名写作 "Estela"；命令、包名和标识中写作 `estela`。 | 全部小写与旧风格一致，但 "Estela" 是专有名称。 |
| D2 | 不回退读取旧环境变量、旧 schema id 或旧缓存。 | 回退读取要付出代码和测试成本，而对应的用户并不存在。 |
| D3 | 待发布的 changeset 改为指向 `@rivus/estela`，正文使用新的命令名和环境变量名。 | 它们尚未发布，将成为 `@rivus/estela` 的第一份 changelog。 |
| D4 | `apps/cli/CHANGELOG.md` 中已发布的条目、`.changeset/ledger.yaml` 和 `v0.1.0` tag 保持不变。changelog 的标题手工改为 `# @rivus/estela`，并加一行说明 0.1.0 及之前的版本以 `@rivus/agent-trace` 发布。 | 它们记录以旧名称发布的内容。Changesets 只在文件为空时写入标题，之后的条目都插在标题下方；不改的话，`@rivus/estela` 的条目会一直挂在旧名称下。 |
| D5 | Plan 0003 保留其中引用的旧 `--version` 输出（`agent-trace/0.0.0`）。 | 那是该次修改之前实际观察到的输出。 |

## 3. 详细设计

### 3.1 更名的标识类别

| 旧 | 新 |
| --- | --- |
| 产品名 agent-trace / Agent Trace | Estela |
| `@rivus/agent-trace`，bin `agent-trace` | `@rivus/estela`，bin `estela` |
| `@rivus/agent-trace-<x>`（`web`、`e2e`、`rpc`、`kernel`、`schema`、`runtime-node`） | `@rivus/estela-<x>` |
| 根工作区名 `agent-trace` | `estela` |
| manifest、文档、`.changeset/config.json`、`renovate.json` 中的 `PerfectPan/agent-trace` | `PerfectPan/estela` |
| `AGENT_TRACE_*` 环境变量和 `AGENT_TRACE_BUNDLE` 构建常量 | `ESTELA_*` |
| 缓存目录 `rivus-agent-trace` | `rivus-estela` |
| `schema: 'agent-trace'`（`TRACE_SCHEMA`、文件头检查、fixture） | `schema: 'estela'` |
| ATIF `extra.agent_trace` | `extra.estela` |
| OTLP `service.name` 和 scope 名 `agent-trace` | `estela` |
| DevFrame id 和 RPC 命名空间 `agent-trace`（共享状态 `agent-trace:sessions`、stream `agent-trace:load-progress`、MCP 工具 `agent-trace_reconstruct`） | `estela` |
| 开发服务器路径 `/__agent-trace/` | `/__estela/` |
| 默认导出文件 `agent-trace-<session>.<format>.json`、报告临时目录 `agent-trace-report-*` | `estela-...` |
| localStorage 键 `agent-trace-theme`、`agent-trace-locale` | `estela-theme`、`estela-locale` |
| 无 agent 的 canonical trace 在 trace id 中使用的回退 agent 标签 `agent-trace` | `estela` |
| 测试和脚本的临时名称（`agent-trace-smoke`、`agent-trace-browser-` 等） | `estela-...` |

README 删除关于 Cursor Agent Trace 的页脚，并增加一行说明西班牙语含义（船的航迹）。

### 3.2 保留的历史记录

- `apps/cli/CHANGELOG.md`：已发布的条目，以及说明这些版本当时所用包名的那一行。
- `.changeset/ledger.yaml`：`@rivus/agent-trace@0.1.0` 记录。
- `docs/plans/0003-cli-layers.md` 及其阅读版：旧的 `--version` 输出。
- 本计划及其阅读版，其中提到旧标识。
- `v0.1.0` tag 和 Release。

### 3.3 兼容与迁移

不读取任何旧名称。升级后，`AGENT_TRACE_*` 变量被忽略，`schema: 'agent-trace'` 的 canonical 文件
不再被识别，索引在 `rivus-estela` 下重建，主题和语言选择重置一次。没有 CLI 命令会写出 canonical
trace 文件，所以只有仓库自己的 fixture 和 `scripts/generate-trace.mjs` 带有 schema id，二者都在本次
修改。无 agent 的 canonical trace 的 trace id 会变化；trace id 只保存在缓存中。changeset 告诉 CLI
用户新的包名、命令、环境变量和缓存目录，以及旧缓存目录可以删除。

## 4. 发布与稳定性

### 4.1 门禁与发布阶段

PR 在 6.4 的所有检查通过后合入。之后所有者为 GitHub 仓库改名并发布 `@rivus/estela`（第 7 节）。
在改名之前，指向 `PerfectPan/estela` 的链接无法访问；改名之后，GitHub 会重定向旧 URL。
`@changesets/changelog-github` 从 `.changeset/config.json` 读取 `PerfectPan/estela`；如果 Publish
workflow 的 version job 在改名之前就在合入提交上运行并失败，改名后重新运行它。

### 4.3 回滚

回滚该 PR。不需要迁回任何持久数据：旧缓存目录仍在磁盘上。如果 `@rivus/estela` 已经发布，对该版本
执行 deprecate，而不是 unpublish。

## 5. 验证

### 5.1 功能检查

单元、集成、smoke 和 e2e 测试使用更名后的标识运行；比较命令名、schema id、OTLP service name、MCP
工具名和服务器路径的测试期望新值。

### 5.3 兼容性检查

待发布 changeset 指向 `@rivus/estela` 时，`node scripts/check-release-plan.mjs` 通过。
`git grep -i -E "agent[-_ ]?trace"` 只列出 3.2 中的内容。

## 6. 执行计划

### 6.1 前置条件

新名称和 2.4 中的决策已在 issue #89 中确认。

### 6.2 完成条件

- 1.3 成立。
- 一个 `@rivus/estela` 的 minor changeset 面向 CLI 用户说明更名。

### 6.3 执行顺序

一个批次，一个 PR。

#### Task 1: 计划

- Files: `docs/plans/0004-rebrand-estela.md`、`docs/plans/0004-rebrand-estela.zh-CN.md`、`docs/plans/README.md`
- Change: 本计划及其阅读版；在列表中标为进行中。
- Tests: `node scripts/check-doc-translations.mjs`
- Exit condition: 检查通过。

#### Task 2: 更名

- Files: `git grep -l -i -E "agent[-_ ]?trace"` 列出的所有已跟踪文件（3.2 除外）；`pnpm-lock.yaml`；新增 `.changeset/rebrand-estela.md`。
- Change: 按以下顺序替换 3.1 中的类别：`PerfectPan/agent-trace`、`@rivus/agent-trace`、`rivus-agent-trace`、`AGENT_TRACE`、`agent_trace`、`Agent Trace`、`agent-trace`；然后调整正文和 UI 文案中产品名的大小写；在两份 README 中删除页脚并加入西班牙语含义一行；运行 `pnpm install`。
- Tests: 现有测试，其中的期望值随之更名。
- Exit condition: 6.4 的每一行都通过，残留检索只列出 3.2。

### 6.4 验证记录

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| 1 | `node scripts/check-doc-translations.mjs`、`node scripts/check-conventions.mjs`、`node scripts/check-release-plan.mjs` | 通过 |
| 1 | `pnpm install`、`node scripts/format.mjs --check`、`node scripts/lint-scripts.mjs`、`pnpm lint` | 通过，lockfile 中没有旧名称 |
| 1 | `pnpm test`、`pnpm typecheck`、`pnpm build` | 通过 |
| 1 | `node scripts/check-layers.mjs`、`node scripts/check-browser-bundle.mjs` | 通过 |
| 1 | `cd apps/e2e && pnpm run test:smoke`、`pnpm run test:e2e` | 通过；tarball 安装出 `estela` bin |
| 1 | `git grep -i -E "agent[-_ ]?trace"` | 只有 3.2 |

### 6.5 按批次回滚

发布前回滚这一个 PR。发布后见 4.3。

## 7. 风险、待定问题与后续事项

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| 将 GitHub 仓库改名为 `PerfectPan/estela` | follow-up | 链接和 changelog 生成器指向新名称 | 仓库所有者 | 本 PR 合入时 |
| 首次手动发布 `@rivus/estela` 并为其配置 npm trusted publishing | follow-up | npm 上不存在的包无法通过 trusted publishing 由 Publish workflow 发布 | 仓库所有者 | 首次发布之前 |
| `npm deprecate @rivus/agent-trace`，指向 `@rivus/estela` | follow-up | 旧安装能看到新名称 | 仓库所有者 | `@rivus/estela` 发布之后 |
| version job 可能在仓库改名前运行 | risk | 重新运行之前不会打开 version PR | 仓库所有者 | 合入后立即改名；若 Publish workflow 失败则重新运行 |
| 更新 GitHub 仓库描述 | follow-up | 仓库页面显示旧名称 | 仓库所有者 | 与仓库改名同时 |
