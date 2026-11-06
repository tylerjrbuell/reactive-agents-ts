---
"@reactive-agents/cli": patch
---

`rax cortex --host <addr>` sets the Cortex listen address. Cortex binds 127.0.0.1 by default; `--host` (or `CORTEX_HOST`) is the explicit opt-in to expose it, which has no authentication, to the network.
