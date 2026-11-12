---
"@rivus/estela": patch
---

Fix a flaky session index open under concurrent launches: node:sqlite reports extended result codes, and a reader that opens while another process converts the index to WAL or rebuilds it got SQLITE_BUSY_RECOVERY (261) or SQLITE_IOERR, which the open loop classified as fatal and gave up on the index. Busy and I/O errors are now matched as primary codes and retried until the open deadline.
