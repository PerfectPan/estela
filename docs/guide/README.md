# User guide

Estela reads the session logs that agents keep on your machine and shows them in a local web page: every session in one list, and for one session its requests, events, token counts, list cost, and the context the model received at each request.

Read in this order if you are new:

1. [Getting started](getting-started.md): install, run, open a session.
2. [Concepts](concepts.md): session, turn, request, event, lane, compaction, "Model saw", and `unavailable`.
3. [The workspace](workspace.md): the timeline, the ledger, the inspector tabs, Compare, and cost.

Then, as needed:

- [Supported agents](supported-agents.md): where each agent's sessions are found and what each agent's log records.
- [Reports and exports](exports.md): a static report to share, and ATIF and OTLP files for other tools.
- [MCP tools](mcp.md): let an agent inspect earlier sessions.
- [DeepSeek Harness plugin](dsh-plugin.md): view the current session inside `dsh web` without running the CLI.
- [Privacy and redaction](privacy.md): what stays local, what redaction covers, what a report still contains.
- [Troubleshooting](troubleshooting.md): Node version, ports, unreadable files, the index cache.

Reference: [command line and public interface](../reference/public-interface.md), [export formats](../reference/export-formats.md), [MCP tools](../reference/mcp-tools.md).
