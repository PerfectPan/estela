> 中文阅读版。以英文原文 docs/guide/exports.md 为准。

# 报告与导出

Estela 可以从一个会话写出三种文件：

| 文件 | 命令 | 用途 |
|---|---|---|
| 报告：单个 `index.html` | `estela build`，或工作区中的「导出报告」 | 将会话分享给他人，对方直接在浏览器中打开 |
| ATIF 轨迹（JSON） | `estela export-atif` | 用于 Harbor 数据集、评测及其他 ATIF 工具 |
| OTLP/JSON trace 请求 | `estela export-otlp` | 用于追踪后端：Langfuse、LangSmith、Phoenix |

每个命令接受与 `estela <path>` 相同的会话参数：会话文件、`path#sessionId` 或规范 Estela JSON trace。未传入参数时使用 `ESTELA_PATH`，若也未设置则使用内置示例会话。每个命令只加载会话一次；无法加载会话或无法写入文件时，会输出原因并以状态码 1 退出。

## 报告

```sh
estela build <session> --out-dir report
```

该命令写出 `report/index.html`（默认输出目录为 `dist-static`）。**`build` 会在确认可以安全覆盖后替换输出目录**：`--out-dir` 必须是新路径、空目录，或只包含先前 Estela 报告 `index.html` 的目录。`/`、你的工作目录、你的主目录、符号链接、非目录路径以及包含其他文件的目录都会被拒绝。

在工作区中，「导出报告」会在启动服务器的工作目录下创建一个新目录 `estela-report-<traceId>-<time>/` 并将同一文件写入其中，同时显示该路径。它从不替换已存在的目录。

报告是将该会话的工作区打包成的单个静态网页。无需服务器、无需联网即可在浏览器中直接从磁盘（`file://`）打开：数据、脚本、样式和字体都内嵌在文件内。它包含时间线、事件列表、「模型所见」、「对比」和费用，使用导出时激活的语言（`build` 命令使用浏览器的语言），并保留语言和主题切换开关。

报告包含的内容：

- 全部事件，其中长文本按工作区视图中的规则截短；
- 前 2,000 个事件或 20 MB（取较小者）的完整事件与原始日志记录；当报告未包含全部事件时，页头会予以说明，其余事件在「原始记录」中会显示「此报告未包含该事件的原始记录。」

无论 `ESTELA_REDACT` 的取值如何，报告始终已脱敏，但脱敏仅移除你的主目录和部分已知 Token 格式。**会话文本和文件内容仍保留在报告中。分享前请先阅读内容。**详见[隐私与脱敏](privacy.zh-CN.md)。

## ATIF 导出

```sh
estela export-atif <session> --out trajectory.json
```

写出一份 [ATIF v1.8](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md) 轨迹并打印 `Wrote <path>`。未指定 `--out` 时，默认在工作目录下写出 `estela-<first 8 characters of the session id>.atif.json`（若该文件或符号链接已存在，则依次追加 `-2`、`-3` 等后缀）。指定 `--out` 时，Estela 会创建缺失的父目录，覆盖已存在的常规文件，并拒绝通过符号链接写入（`export-otlp` 适用相同规则）。

- 每条提示词、每次模型请求（及其回复和工具调用）以及每次上下文压缩分别对应一个步骤。每个步骤都在 `extra.estela.eventIds` 中列出其来源的 Estela 事件 id。
- 被上下文压缩移除的事件不生成步骤；从压缩前保留下来的步骤带有 `is_copied_context: true`，上下文压缩本身成为一个 system 步骤，并在记录了触发原因或 Token 数时附带 `extra.context_management`。
- 子代理作为内嵌轨迹写入 `subagent_trajectories`，并由启动它们的步骤引用。
- Token 数写入各步骤的 `metrics`。每个已计价请求的目录价写入 `metrics.cost_usd`，且仅当所有请求均已计价时才写入 `final_metrics.total_cost_usd`；`extra.estela.pricing` 标明价格快照以及未计价请求的数量。

使用 Harbor 的校验器验证导出文件：

```sh
uv run --python 3.12 --with harbor python -m harbor.utils.trajectory_validator trajectory.json
```

## OTLP 导出

```sh
estela export-otlp <session> --out session.otlp.json
```

写出一份 OTLP/JSON `ExportTraceServiceRequest`（默认文件名为 `estela-<first 8 characters of the session id>.otlp.json`）。其中的 span 携带 `gen-ai-dev/1.42.0-dev` 的 OpenTelemetry GenAI 属性：每条代理泳道一个 `invoke_agent` span、每次模型请求一个 `chat` span（含其用量和模型所见的消息），以及每次工具调用一个 `execute_tool` span。之后被上下文压缩移除的请求和工具调用仍保留各自的 span，但不再出现在压缩后各请求的消息列表中。OTLP 导出处于实验阶段：GenAI 语义约定尚未发布正式版，因此当 Estela 升级到更新版本时，属性名称可能会发生变化。由于这些约定未定义费用属性，该导出不包含费用信息。

需由你自行将文件发送到后端；Estela 不发送任何数据。Langfuse 可直接接收 OTLP/JSON：

```sh
curl -H "Content-Type: application/json" -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  --data-binary @session.otlp.json https://cloud.langfuse.com/api/public/otel/v1/traces
```

LangSmith 和 Phoenix 接收 OTLP/protobuf。可使用保存为 `otlp-to-pb.py` 的以下脚本将文件转换一次。OTLP/JSON 将 trace id 和 span id 写作十六进制字符串，而 protobuf 的 JSON 读取器要求 base64，因此脚本会先转换这些 id：

```python
import base64, json, sys
from google.protobuf.json_format import ParseDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
d = json.load(open(sys.argv[1]))
for rs in d["resourceSpans"]:
    for ss in rs["scopeSpans"]:
        for s in ss["spans"]:
            for k in ("traceId", "spanId", "parentSpanId"):
                if k in s: s[k] = base64.b64encode(bytes.fromhex(s[k])).decode()
sys.stdout.buffer.write(ParseDict(d, ExportTraceServiceRequest()).SerializeToString())
```

```sh
uv run --with opentelemetry-proto python otlp-to-pb.py session.otlp.json > session.otlp.pb
curl -H "Content-Type: application/x-protobuf" --data-binary @session.otlp.pb http://localhost:6006/v1/traces
```

最后一行将数据发送到本地 Phoenix；对于 LangSmith，请按其文档说明使用对应的 OTLP 端点和 API 密钥请求头。这些步骤生成有效请求（16 字节 trace id、8 字节 span id）；本指南编写时未重新测试向各后端的写入。

## 导出文件的脱敏

ATIF 和 OTLP 文件按与本地服务器相同的方式脱敏：你的主目录变为 `~`，且[隐私与脱敏](privacy.zh-CN.md#脱敏覆盖的范围)中列出的 Token 模式会被替换。当数据集或后端需要未脱敏数据时，可通过 `ESTELA_REDACT=0` 原样写出记录的文本：

```sh
ESTELA_REDACT=0 estela export-atif <session> --out trajectory.json
```

两种格式的完整字段映射见[导出格式](../reference/export-formats.zh-CN.md)。
