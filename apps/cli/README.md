# @rivus/estela

A local viewer for agent sessions: every request, what the model saw, and what it cost. It lists the sessions of Claude Code, Codex, DeepSeek Harness, Gemini CLI, Grok, OpenCode, and Pi on this machine, opens one in a workspace in your browser, and rebuilds the context the model received at any event. Anything a log does not record is shown as `unavailable`, never estimated.

Requires Node.js 24 or later.

```sh
npx @rivus/estela                          # session browser in your browser
npx @rivus/estela <session>                # open one session's workspace
npx @rivus/estela --pick                   # pick a session in the terminal
npx @rivus/estela build <session> --out-dir report      # one redacted index.html
npx @rivus/estela export-atif <session> --out run.json  # ATIF v1.8 trajectory
npx @rivus/estela export-otlp <session> --out run.json  # OTLP/JSON trace request
npx @rivus/estela mcp                      # MCP tools over every session, on stdio
npx @rivus/estela mcp <session>            # MCP tools over one session
```

`<session>` is a session file, `path#sessionId`, or a canonical Estela JSON trace. `estela --help` and `estela <command> --help` list every option.

The server binds `localhost` and sends nothing anywhere. Reports and MCP results are always redacted (home directory and some token shapes, not every secret); a report still holds session text and file contents, so read it before you share it. The session index is a cache in `$XDG_CACHE_HOME/rivus-estela/` (default `~/.cache/rivus-estela/`); delete it at any time.

- User guide: https://github.com/PerfectPan/estela/blob/main/docs/guide/README.md
- Supported agents and what each records: https://github.com/PerfectPan/estela/blob/main/docs/guide/supported-agents.md
- MCP setup for Claude Code, Codex, and Gemini CLI, and the agent skill: https://github.com/PerfectPan/estela/blob/main/docs/guide/mcp.md
- Privacy and redaction: https://github.com/PerfectPan/estela/blob/main/docs/guide/privacy.md
- Public interface and compatibility: https://github.com/PerfectPan/estela/blob/main/docs/reference/public-interface.md

_Estela_ is Spanish for a wake: the trail a ship leaves on the water. A session log is the trail an agent leaves behind, and Estela reads it.

Licenses of the bundled third-party code: `dist/THIRD-PARTY-NOTICES.txt`.

Source and issues: https://github.com/PerfectPan/estela
