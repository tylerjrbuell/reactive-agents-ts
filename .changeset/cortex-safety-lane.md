---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

The run view has a **Safety** tab: every time a guardrail, the verifier or result check, a budget, the context window, calibration or the reactive controller stepped in, in plain words, each linked to its loop. When anything fired, the run header shows the count and each affected loop row in the trace carries a badge. ui-core adds `safetyEntriesOf` / `safetySummaryOf` (the lane, for any builder's own UI) and `foldRunStrategy` / `runStrategyOfEvents`: one rule for a run's strategy (resolved config, then the kernel loop, then step events), now used by both the run view and the stored run row, so they no longer disagree. A run that ends with `AgentAborted` (for example an output guardrail block) now settles as failed, or stopped after a user stop, instead of reading Running forever.
