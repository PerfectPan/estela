> 中文阅读版。以英文原文 docs/development/adding-an-agent.md 为准。

<!-- source-blob: 9216c3253c172334697e7a7a01d35c0f95324353 -->

# 添加代理

受众：为新编程代理添加会话读取支持，或为现有读取器扩展新能力的贡献者。

会话读取位于 [`@rivus/agent-kit`](https://github.com/PerfectPan/agent-kit)；Estela 将该套件打包进来，并接入读取器的夹具、显示元数据、界面颜色和文档。因此添加新代理按顺序跨越两个仓库：先在 `agent-kit` 中实现读取器及其一致性测试套件，再在 `estela` 中接入。

## 1. 在 `@rivus/agent-kit` 中实现读取器

所有会话适配器都位于 [`PerfectPan/agent-kit`](https://github.com/PerfectPan/agent-kit) 的 `packages/providers/<agent>/` 私有提供方包下（其边界与 lint 规则见该仓库的 `docs/architecture/authoring.md`）。

1. **创建或扩展提供方包** `packages/providers/<agent>/`：
   - `src/facts.ts`：规范代理 id、显示名称、默认主目录规则和环境变量覆盖项。
   - `src/layout.ts` 与 `src/records.ts`（或 `src/records/`）：会话读取与用量解码共用的存储布局和 `zod/mini` 记录 schema。
   - `src/identity.ts`：`CodingAgent` 身份条目。
   - `src/sessions.ts`（辅助模块放在 `src/sessions/` 下）：`SessionAdapter`（`specificationVersion: "sessions-v1"`）。
2. **实现 `SessionAdapter` 契约**：
   - `discover`：在代理根目录下枚举会话引用，不加载完整转录。
   - `detect` / `isSessionHead`：在通过路径直接打开时识别该代理的会话文件。
   - `load`：将记录转换为有序的 `TranscriptEvent`；日志记录了版本时填入 `agentVersion`，按实际提取的数据声明 `capabilities`，并记录准确的 `SourcePointer` 偏移（字节范围、解压后行偏移或 SQLite 行指针），以便 `readOriginal` 回读任意事件的原始记录。
   - `summarize`：流式计算摘要计数与提示词，不物化完整转录。
   - **遇到未知格式代次时显式报错**：当文件头、schema 版本或记录外层结构属于不支持的代次时，返回 `UnknownFormatGeneration`（切勿静默丢弃或猜测）。
3. **将提供方接入套件外壳**：
   - 在 `packages/agent-kit/src/providers/` 中注册服务（`identity`、`sessions` 和 `builtin.ts`），并从 `packages/agent-kit/src/providers/unsupported.ts` 移除对应的未支持条目。
   - 更新 `packages/agent-kit/README.md` 中的支持矩阵（由 `packages/agent-kit/test/provider-tables.test.ts` 检查）。
4. **添加一致性测试夹具与测试** `packages/providers/<agent>/test/`：
   - 编写合成夹具，覆盖每个声明的能力（请求、用量、推理、上下文压缩、子代理、钩子、系统提示词、工具 schema），以及一条未知类型记录和一个未知代次失败用例。
   - 运行来自 `@rivus/agent-kit/testing` 的 `sessionAdapterConformance(adapter, fixtures)`，并确认套件的全部测试、类型检查与边界检查均通过。
5. **发布 `@rivus/agent-kit`**，按其发布手册执行（`agent-kit` 中的 `docs/development/release.md`）。

## 2. 在 Estela 中接入代理

新版本 `@rivus/agent-kit` 发布到 npm 后，在 Estela 中接入（参考 PR `#162` 和 `#165`）：

### 升级套件依赖

1. 更新 `pnpm-workspace.yaml` 中的 `'@rivus/agent-kit'`，并运行 `pnpm install` 刷新 `pnpm-lock.yaml`。由于 `@rivus/agent-kit` 位于 `minimumReleaseAgeExclude`，npm 发布后即可立即安装。
2. 如果套件发布更改了任何 `TranscriptEvent` 负载结构或新增了 Estela 需要读取的字段，在同一个 PR 中更新 `packages/schema/src/types.ts` 和 `packages/schema/src/payloads.test.ts`。

### 接入服务端适配器元数据

`packages/server/src/sessions/adapters.ts` 会自动将每个导出 `.sessions` 的内置套件提供方加载到 `builtinAdapters`。检查该文件中的两张表：

- `PRODUCT_NAMES`：当套件适配器的 `displayName` 只是原始 id 而非产品名时添加条目（例如 `opencode: 'OpenCode'`）。
- `DATABASE_AGENTS`（`keepsSessionsInDatabase`）：当该代理将所有会话作为行保存在单个 SQLite 数据库中时加入其代理 id。`packages/server/src/sessions/conformance.test.ts` 会校验 `keepsSessionsInDatabase(agent)` 与适配器事件是否携带 `source.sqlite` 保持一致。

### 复制一致性测试夹具并注册套件

1. 将套件读取器的一致性测试夹具复制到 `fixtures/sessions/<agent>/conformance/`（保留代理原有文件名）。如果读取器会拒绝未知格式代次，也一并添加 `fixtures/sessions/<agent>/unknown-generation/` 夹具。
2. 在 `packages/server/src/sessions/conformance.test.ts` 中注册该代理：
   - 添加 `ConformanceSession[]` 列表，列出每条夹具的路径、`records` 数量、`capabilities`，按需填写 `files`（子代理附属日志）和 `sessionId` / `recordKeys`（SQLite 数据库或压缩日志）。
   - 将 `[agent, sessions]` 加入 `SUITES`。`covers every built-in adapter` 测试会强制要求每个内置适配器都出现在 `SUITES` 中。
   - 若发现根目录位于一致性目录的子目录中，添加到 `DISCOVERY_ROOTS`；若测试超大文件拒绝行为，添加到 `OVERSIZED_LINES`。
   - 若有未知代次夹具，添加到 `unknown generations fail loud on the repo fixtures`。

### 添加 Web 界面与站点元数据

| 位置 | 文件 | 需要添加的内容 |
|---|---|---|
| Web 显示名称 | `apps/web/src/lib/agent-names.ts` | `AGENT_NAMES[<id>]`：英文产品名称（不翻译）。 |
| Web 代理徽标 | `apps/web/src/browser/agent-mark.tsx` | `LETTER[<id>]`：1–2 个字母标记。 |
| Web 主题颜色 | `apps/web/src/styles.css` | 在深色（`:root, html[data-theme="dark"]`）与浅色（`html[data-theme="light"]`）令牌块中添加 `--agent-<id>`。 |
| 站点代理列表 | `apps/site/src/content/agents.ts` | 包含 `id`、`name`、`paths` 和主目录覆盖变量 `home` 的条目。 |
| 站点主题颜色 | `apps/site/src/styles.css` | 在浅色（`:root`）与深色（`.dark`）令牌块中添加 `--agent-<id>`。 |
| 站点代理数量文案 | `apps/site/src/i18n/dictionary.en.ts`、`apps/site/src/i18n/dictionary.zh-CN.ts` | 若落地页文案提及支持的代理数量，同步更新。 |

### 更新文档与 changeset

`docs/guide/`、`docs/reference/`、`docs/architecture/`、`docs/development/` 下的每篇文档以及根目录 `README.md` 都有 `.zh-CN.md` 中文阅读版，需在同一 PR 中同步更新：

1. `docs/guide/supported-agents.md`（及 `.zh-CN.md`）：更新套件版本与代理数量，在**会话位置**中添加该代理，在**各代理记录的内容**中添加其**测试版本**（取自一致性测试夹具，无记录时写「未记录」）和能力行，并在**已知限制**中记录限制。
2. `docs/guide/troubleshooting.md`（及 `.zh-CN.md`）：在**显示 0 个会话的代理**下的环境变量列表中加入该代理的主目录覆盖变量。
3. `README.md`（及 `.zh-CN.md`）、`docs/guide/getting-started.md`（及 `.zh-CN.md`）、`docs/architecture/overview.md`（及 `.zh-CN.md`）以及 `docs/reference/public-interface.md` / `docs/reference/mcp-tools.md`（及 `.zh-CN.md`）中涉及代理列表、数量或主目录覆盖变量的位置。
4. 使用 `node scripts/check-doc-translations.mjs --write <zh-CN 文件...>` 记录更新后的英文 blob 哈希。
5. 在 `.changeset/` 下为 `@rivus/estela` 添加 changeset（新增代理使用 `minor`，更新现有读取器使用 `patch`；见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md#kit-upgrades-and-format-change-releases)）。

### 验证

运行[开发指南](setup.zh-CN.md#检查项)中的全部检查项：

```bash
node scripts/format.mjs --check
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
node scripts/check-release-intent.mjs
node scripts/lint-scripts.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @rivus/estela-schema run duplicates
pnpm --filter @rivus/estela-schema run knip
pnpm --filter @rivus/estela-schema run knip:production
pnpm build
node scripts/check-budgets.mjs
```
