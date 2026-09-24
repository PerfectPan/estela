# @rivus/agent-trace

Local DevTools for coding-agent session logs (Claude Code, Codex, Grok). It lists the sessions on this machine, opens one in a workspace in the browser, and reconstructs what the model saw at any event.

Requires Node.js 22.18 or later (not 23.0 to 23.5).

```sh
npx @rivus/agent-trace                         # session browser in the default browser
npx @rivus/agent-trace <session-path>          # open one session's workspace
npx @rivus/agent-trace --pick                  # pick a session in the terminal
npx @rivus/agent-trace build <session-path> --out-dir report
npx @rivus/agent-trace mcp <session-path>      # MCP server on stdio
```

The server binds `localhost`. `build` always redacts the home directory and known token patterns. The session index is a cache at `$XDG_CACHE_HOME/rivus-agent-trace/` (default `~/.cache/rivus-agent-trace/`); delete it at any time.

Source and issues: https://github.com/PerfectPan/agent-trace
