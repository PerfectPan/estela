# @rivus/dsh-estela

Adds an **Estela** view beside Chat and Trajectory in `dsh web` that reads the current session log from disk: the ledger, what the model saw at any request (**Model saw**), a context diff (**Compare**), what a compaction removed, and list-price cost. Anything a log does not record is shown as `unavailable`, never estimated.

Requires DeepSeek Harness `>=0.2.2-rc.5 <0.3.0-0` and Node.js `>=24.9.0`.

## Install

```sh
dsh plugin --profile web add @rivus/dsh-estela
```

Remove it at any time:

```sh
dsh plugin --profile web remove @rivus/dsh-estela
```

## What the View shows and its limits

- **Current session only**: opens the active conversation in `dsh web`. A blank session shows no View tabs until a turn starts.
- **Read-only and local**: reads the session log inside `dsh`'s own process and sends nothing outside `dsh web`. Redaction is on by default (`ESTELA_REDACT=0` disables it).
- **Snapshot**: reloads when you reload the page or switch sessions; live follow is not supported. A session browser and "Export report" are not included in this plugin (use the `@rivus/estela` CLI for those).

## License

Licensed under `GPL-3.0-only` (`LICENSE`). Licenses of bundled third-party code: `dist/THIRD-PARTY-NOTICES.txt`.

Source and issues: https://github.com/PerfectPan/estela
