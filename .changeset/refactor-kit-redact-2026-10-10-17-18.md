---
"@rivus/agent-trace": patch
---

Redaction now also hides PEM private key blocks, more token families (ASIA, gho_, ghu_, ghs_, ghr_, github_pat_, npm_) and more spellings of the home directory (URL-encoded, ~user, Windows forms). A token prefix glued to a preceding letter or digit is no longer redacted, which keeps words like `task-...` readable.
