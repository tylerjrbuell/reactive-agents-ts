---
"@reactive-agents/cortex": patch
"@reactive-agents/ui-core": patch
---

Cortex no longer blocks or warns about Code Action runs the framework allows. The up-front 409 and the strategy note now ask the framework's own `codeActionApprovalConflict` with the agent's real callable tools and approval policy, so the default approval gate only conflicts when a gated tool (for example `file-write`) is callable, and the message names the gated tools. `strategyApprovalConflictOf` in ui-core now words the framework's verdict (`refuse`, `gatedCallable`) instead of deciding it, and `StrategyApprovalConflict` gains `gatedTools`.
