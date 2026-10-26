---
"@rivus/agent-trace": minor
---

Add export-atif and export-otlp: write a session as one ATIF v1.8 trajectory (for Harbor datasets and evaluation) or one OTLP/JSON request with OpenTelemetry GenAI attributes (for Langfuse, LangSmith, and Phoenix). Exports are redacted unless AGENT_TRACE_REDACT=0.
