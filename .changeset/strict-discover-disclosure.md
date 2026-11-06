---
"@reactive-agents/reasoning": patch
---

`.withTools({ disclosure: "discover" })` now loads tools on demand, as documented. The first turn offers only meta tools (including `discover-tools`) and required tools. A permitted domain tool becomes visible and callable only after `discover-tools` surfaces it (or after it has been used). In this mode `allowedTools` and `builtins` bound what may be discovered and run; they no longer make tools visible up front, and the never-zero floor adds no keyword picks. Tier-default disclosure and the `all` / `index` modes are unchanged.
