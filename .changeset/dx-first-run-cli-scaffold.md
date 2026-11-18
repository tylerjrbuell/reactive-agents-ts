---
"@reactive-agents/cli": patch
"create-reactive-agent": patch
---

`rax run --tools` now enables the built-in tools (it enabled none since built-ins became opt-in, and printed a warning). `rax run --verbose` shows phase lines when output is piped, `--quiet` prints only the answer on a terminal too (no live status line), and `--stream` no longer draws the live status line over the streamed tokens. On a terminal, `rax run` no longer runs its own spinner on top of the framework's status line.

Scaffolded projects treat the `.env.example` placeholder `your-key-here` as a missing key: a `.env` copied without editing now prints the "set <KEY>" message instead of failing on a provider 401 with a stack trace. The printed next steps say `cp .env.example .env` instead of an `echo` that wrote the placeholder as the key.
