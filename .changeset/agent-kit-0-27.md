---
"@rivus/estela": minor
---

Read more of each agent's log, from `@rivus/agent-kit` 0.27.0: DeepSeek Harness request durations, local subagents as lanes, and hooks; OpenCode and ZCode durations, compactions with their token counts, and subagent lanes; ZCode's recorded system prompt; DimCode run durations and reasoning; Kimi Code reasoning, compactions, hooks, and subagents; Codex tool definitions, hooks, and the token count before a compaction. ZCode 0.16.5 databases are read. A subagent the session records but whose log is missing shows a lane marked "log unavailable". A DimCode session keeps its cached summary across a start where nothing was written to it, as OpenCode and ZCode sessions do. On Windows, a session path typed with `\` is read by the kit itself.
