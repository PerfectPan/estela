# Reports and exports

Estela writes three kinds of files from one session:

| File | Command | For |
|---|---|---|
| Report: one `index.html` | `estela build`, or "Export report" in the workspace | Sharing a session with a person, who opens it in a browser |
| ATIF trajectory (JSON) | `estela export-atif` | Harbor datasets and evaluation, other ATIF tools |
| OTLP/JSON trace request | `estela export-otlp` | Tracing backends: Langfuse, LangSmith, Phoenix |

Each command takes the same session argument as `estela <path>`: a session file, `path#sessionId`, or a canonical Estela JSON trace. Without one they use `ESTELA_PATH`, and without that a bundled demo session. Each loads the session once; a session that cannot be loaded or a file that cannot be written exits with status 1 and the reason.

## Report

```sh
estela build <session> --out-dir report
```

This writes `report/index.html` (the default directory is `dist-static`). **`build` replaces the output directory: an existing directory at that path is deleted first, with everything in it.** Pick a new or empty directory.

In the workspace, "Export report" writes the same file into a new directory `estela-report-<traceId>-<time>/` in the directory the server was started from, and shows the path. It never replaces an existing directory.

The report is the session's workspace as one static page. It opens from disk (`file://`) in a browser with no server and no network: the data, script, styles, and fonts are inside the file. It has the timeline, ledger, Model saw, Compare, and cost, in the language that was active when it was exported (the browser's language for `build`), with the language and theme switches.

What the report holds:

- every event, with long texts shortened as in the workspace view;
- the full event and the original log record of the first 2,000 events or 20 MB, whichever is smaller; the header says when the report holds fewer than all events, and Raw says "not included in this report" for the others.

A report is always redacted, whatever `ESTELA_REDACT` says, but redaction removes only your home directory and some token shapes. **Session text and file contents remain in the report. Read it before you share it.** See [Privacy and redaction](privacy.md).

## ATIF export

```sh
estela export-atif <session> --out trajectory.json
```

Writes one [ATIF v1.8](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md) trajectory and prints `Wrote <path>`. Without `--out` the file is `estela-<first 8 characters of the session id>.atif.json` in the working directory; `--out` creates missing parent folders and overwrites an existing file.

- One step per prompt, per model request with its reply and tool calls, and per compaction. Each step lists the Estela event ids it came from in `extra.estela.eventIds`.
- Events a compaction removed produce no step; steps kept from before a compaction carry `is_copied_context: true`, and the compaction is a system step with `extra.context_management`.
- Subagents are embedded trajectories in `subagent_trajectories`, referenced from the step that started them.
- Token counts go to each step's `metrics`. The list cost goes to `metrics.cost_usd` for each priced request, and `final_metrics.total_cost_usd` only when every request is priced; `extra.estela.pricing` names the price snapshot and how many requests are unpriced.

Validate a file with Harbor's validator:

```sh
uv run --python 3.12 --with harbor python -m harbor.utils.trajectory_validator trajectory.json
```

## OTLP export

```sh
estela export-otlp <session> --out session.otlp.json
```

Writes one OTLP/JSON `ExportTraceServiceRequest` (default name `estela-<first 8 characters of the session id>.otlp.json`). The spans carry the OpenTelemetry GenAI attributes of `gen-ai-dev/1.42.0-dev`: one `invoke_agent` span per agent lane, one `chat` span per model request with its usage and the messages the model saw, and one `execute_tool` span per tool call. The OTLP export is experimental: the GenAI conventions have no release yet, so attribute names can change when Estela moves to a newer version. It carries no cost, because those conventions define no cost attribute.

Post the file to a backend yourself; Estela sends nothing.

```sh
# Langfuse (accepts OTLP/JSON as is)
curl -H "Content-Type: application/json" -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  --data-binary @session.otlp.json https://cloud.langfuse.com/api/public/otel/v1/traces

# LangSmith or Phoenix (OTLP/protobuf receivers: convert once, then post)
uv run --with opentelemetry-proto python -c \
  "from google.protobuf.json_format import Parse; from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest as R; import sys; sys.stdout.buffer.write(Parse(open(sys.argv[1],'rb').read(), R()).SerializeToString())" \
  session.otlp.json > session.otlp.pb
curl -H "Content-Type: application/x-protobuf" --data-binary @session.otlp.pb http://localhost:6006/v1/traces
```

The last line posts to a local Phoenix; for LangSmith, use its OTLP endpoint and API key header as its documentation describes.

## Redaction of exports

ATIF and OTLP files are redacted like the local server: your home directory becomes `~` and the token shapes listed in [Privacy](privacy.md#what-redaction-covers) are replaced. `ESTELA_REDACT=0` writes the recorded text unredacted, for a dataset or backend that needs it:

```sh
ESTELA_REDACT=0 estela export-atif <session> --out trajectory.json
```

The full field mapping of both formats is in [Export formats](../reference/export-formats.md).
