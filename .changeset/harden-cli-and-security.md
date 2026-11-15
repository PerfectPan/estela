---
'@rivus/estela': minor
---

Fix CLI port and loopback host handling and harden Estela against untrusted session content:

- Exit cleanly with code 1 and a plain diagnostic when `--port` is already in use or listening fails (#125).
- Preserve explicit loopback hosts such as `127.0.0.1` and `[::1]` in the printed and opened URLs instead of rewriting to `localhost` (#126).
- Refuse `--no-auth` with non-loopback `--host` values, emit a startup warning when `--no-auth` is active, lock browser WebSocket/SSE `Origin` checks to the server's bound host and port (restricting wildcard binds to loopback and local interface IP literals), and restrict `~/.estela/devframe/` to mode `0700` on POSIX.
- Refuse to wipe `/`, cwd, home, symlinks, non-directories, or unrelated non-empty directories in `build --out-dir` (while still allowing rebuilds over an earlier Estela report).
- Use exclusive `-2`/`-3` suffix allocation for default ATIF/OTLP export filenames and refuse overwriting symbolic links passed to `--out`.
- Enforce strict Content Security Policy headers on dev pages and `file://` reports, bound Zstandard decompression (512 MiB) and canonical trace JSON reads (256 MiB), harden read-only SQLite pragmas, and strip non-SGR terminal escape sequences and bidi format characters from error messages, DevFrame logs, and auth banners.
