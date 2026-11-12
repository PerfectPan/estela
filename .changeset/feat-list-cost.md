---
"@rivus/estela": minor
---

The workspace and reports show what a session's recorded tokens cost at LiteLLM list prices: the session total with its cache hit rate, per turn, per agent, and per request with input, cache, and output shares. Requests without usage or with an unlisted model show cost as unavailable with the reason, and partial sums say how many requests they leave out. `export-atif` writes the same cost to ATIF's `cost_usd` fields.
