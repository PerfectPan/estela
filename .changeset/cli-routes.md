---
"@rivus/agent-trace": patch
---

The CLI now reads its command line once, through one route table: an unknown, repeated, or misplaced flag, an out-of-range value, or a second session path fails with the cause and one fix line before any session is read or indexed, `agent-trace <command> --help` describes each command (the top-level help lists `export-atif` and `export-otlp` too), and `--version` prints the package version instead of `0.0.0`. `--pick` with a session path and `build --pretty` are refused, an empty `AGENT_TRACE_PATH` counts as unset, and `-h` or `-v` after an option that takes a value prints the help or the version.
