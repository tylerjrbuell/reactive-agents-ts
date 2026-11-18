---
"@reactive-agents/cli": patch
---

Fix three false strings in `rax` help output. `rax help` now lists the real `rax init` templates, read from the scaffolder (it listed `minimal|standard|full`, and `standard` and `full` were rejected). The `rax run` usage hint now says `rax cortex` instead of the contributor-only `bun cortex`. `rax cortex --help` now says that a non-loopback `--host` requires `CORTEX_TOKEN`, replacing the stale claim that Cortex has no auth.
