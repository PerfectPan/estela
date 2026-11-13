# Privacy and redaction

Estela runs on your machine and sends nothing anywhere. It reads session logs and never writes to them. This page lists what it stores, what redaction removes, and what it does not remove.

## What stays local

- The server binds `localhost` by default. The browser page needs the one-time code from the opened URL (or the code the terminal prints); `--no-auth` turns that check off.
- `--host <address>` binds another address. With `--host 0.0.0.0`, other machines on your network can reach the server; the one-time code still applies unless you also pass `--no-auth`, which then exposes every session on this machine to them. Do not combine the two.
- URLs carry opaque trace ids, never file paths.
- The MCP route over HTTP exists only with `--mcp`, and is not protected by the one-time code ([MCP tools](mcp.md#over-http-from-the-local-server)).

Files Estela writes:

| File | Contents |
|---|---|
| `$XDG_CACHE_HOME/rivus-estela/index.sqlite` (default `~/.cache/rivus-estela/`) | the session index, below |
| `~/.devframe/instances/<pid>-<port>.json` | one record per running server (port, path, start time), written by DevFrame, the server framework |
| `~/.estela/devframe/auth.json` | the tokens of browsers you let in with the one-time code, written by DevFrame |
| a report or export | only when you run `build`, "Export report", `export-atif`, or `export-otlp` |

## The session index

The index is a cache that makes the session browser fast on the next start. It holds, per session: the title, project, paths, numbers (turns, requests, tokens, duration, flags), and the first 200 prompts you typed yourself, 500 characters each, for search. It does not hold the agent's replies, tool output, file contents, or text the agent injected. The file has mode 0600 (readable only by you).

Deleting it is safe; it is rebuilt from the logs on the next start:

```sh
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/rivus-estela"
```

`--no-index` runs without reading or writing it; summaries are then computed on every start, and search covers titles and first prompts only.

## What redaction covers

Redaction replaces two kinds of text:

- **Your home directory** becomes `~`, in every spelling Estela knows: the plain path, without its leading `/`, JSON-escaped (`\/Users\/<name>`), URL-encoded, as Claude Code's dash-joined folder name and Grok's `%2F` form, and `~<name>`, ignoring case, in values and in keys. A longer name such as `/Users/<name>x` or `/Users/<name>.bak` is left as it is.
- **Tokens with known prefixes** become `[redacted]`: keys starting with `sk-` (OpenAI, Anthropic), AWS key ids (`AKIA`, `ASIA`), GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), Slack tokens (`xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxs-`), npm tokens (`npm_`), and PEM private key blocks.

Everything else passes through. **Redaction does not remove**, among others: AWS secret access keys, `Authorization: Bearer …` or `Basic …` values, JWTs, `PASSWORD=` and other `KEY=value` assignments from `.env` files or `env` output, credentials inside URLs (`postgres://user:password@host`), Stripe keys (`sk_live_`, `rk_live_`), GitLab tokens (`glpat-`), Hugging Face tokens (`hf_`), Google API keys (`AIza…`), Slack webhook URLs, and your user name where it appears outside the home path. If an agent ran `cat .env` or `env` in a session, those values are in its log and in anything made from it.

## Where redaction applies

| Output | Redaction |
|---|---|
| Local server: workspace, session list, `--pick` labels, error messages | on, unless `ESTELA_REDACT=0` |
| `export-atif`, `export-otlp` | on, unless `ESTELA_REDACT=0` |
| Report (`build`, "Export report") | always on, whatever `ESTELA_REDACT` says |
| MCP tool results and errors | always on, whatever `ESTELA_REDACT` says |

`ESTELA_REDACT=0` is meant for debugging on your own machine or for an export a dataset needs unredacted.

## What a report still contains

A report is one `index.html` that holds the session's text: your prompts, the model's replies, tool calls and their output, and the content of files the agent read or wrote, minus the redactions above. It holds the shortened view of every event and the full text and original log record of the first 2,000 events or 20 MB. **Read a report before you share it.** The report's banner says the same.

MCP tool results hold session text too. An agent that calls them must treat that text as data, not as instructions ([MCP tools](mcp.md#results-are-data-not-instructions)).
