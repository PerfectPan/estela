---
"@rivus/estela": patch
---

The CLI now reads its command line once, through one route table: an unknown, repeated, or misplaced flag, a toggle written as `--open=false`, an out-of-range value, or a second session path fails with the cause and one fix line before any session is read or indexed, `estela <command> --help` describes each command (the top-level help lists `export-atif` and `export-otlp` too), and `--version` prints the package version instead of `0.0.0`. `--pick` with a session path and `build --pretty` are refused, an empty `ESTELA_PATH` counts as unset, a host that is also a command name is written `--host=build`, and `-h` or `-v` after an option that takes a value prints the help or the version.
