---
'@rivus/estela': minor
---

- With `--host 0.0.0.0` the printed and opened URLs use `http://127.0.0.1:<port>`, and with `--host ::` they use `http://[::1]:<port>`, instead of a `localhost` URL that another program on the other address family could answer (#135).
- A click on a subagent lane of the timeline selects that lane's request, and Shift-click there picks the request to compare with; the lane draws the selected and compared requests with rings.
- The `--mcp` HTTP route serves only the seven Estela tools, as `estela mcp` does, without DevFrame's shared-state tool.
- Stopping the local server or `estela mcp` with Ctrl-C, SIGTERM, or a closed terminal first writes the finished session summaries to the index, so the next launch does not compute them again.
