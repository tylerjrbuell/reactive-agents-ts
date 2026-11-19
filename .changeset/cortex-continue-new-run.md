---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": patch
---

Cortex chat Continue now starts a new run linked to the one that stopped (`resumeRun(runId, { newRun: true })`) instead of reusing its run id, so each run keeps its own trace file. The continuing turn, the Runs list, the run header, the trace drawer and the compare picker show "continued from <run>" with a link, the stopped run is no longer offered beside its continuation, and runs from before this render unchanged. ui-core adds `continuationsOf` and `continuationChainOf` (run lineage over `continuedFrom`).
