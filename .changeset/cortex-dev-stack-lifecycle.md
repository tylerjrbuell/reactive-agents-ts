---
"@reactive-agents/cortex": patch
---

`scripts/dev-stack.ts` gains `start`, `stop` and `status` subcommands. `start` runs a detached Cortex server and UI on chosen ports (`--port`, `--ui-port`, `--cwd`) and writes one pid file per child; `stop` ends only those recorded processes (never by port, and never a pid whose command line no longer matches); `status` lists pid, liveness and port. Plain `bun start` is unchanged.
