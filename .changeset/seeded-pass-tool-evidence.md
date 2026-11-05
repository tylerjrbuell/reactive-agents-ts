---
"@reactive-agents/reasoning": patch
---

Continuing kernel passes (reflexion improve passes seeded with the run's contract and ledger) now count the run's earlier successful tool calls. A required tool that an earlier pass already ran successfully (for example `file-write`) no longer makes the terminal verifier reject the pass at `agent-took-action`, and the think-path required-tool guards no longer nudge the model to call it again. A seeded pass also takes its post-conditions from the adopted run contract instead of re-deriving them from its own improve prompt. Passes without a seed behave as before.
