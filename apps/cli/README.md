# @rivus/estela

Local DevTools for coding-agent session logs (Claude Code, Codex, Grok). It lists the sessions on this machine, opens one in a workspace in the browser, and reconstructs what the model saw at any event.

Requires Node.js 24 or later.

```sh
npx @rivus/estela                         # session browser in the default browser
npx @rivus/estela <session-path>          # open one session's workspace
npx @rivus/estela --pick                  # pick a session in the terminal
npx @rivus/estela build <session-path> --out-dir report
npx @rivus/estela mcp                     # MCP tools over every session, on stdio
npx @rivus/estela mcp <session-path>      # MCP tools over one session
```

The server binds `localhost`. `build` and the MCP tools always redact the home directory and known token patterns. The session index is a cache at `$XDG_CACHE_HOME/rivus-estela/` (default `~/.cache/rivus-estela/`); delete it at any time.

Setup of the MCP tools for Claude Code, Codex, and Gemini CLI, and the agent skill: https://github.com/PerfectPan/estela#mcp-for-coding-agents

Licenses of the bundled third-party code: `dist/THIRD-PARTY-NOTICES.txt`.

Source and issues: https://github.com/PerfectPan/estela
