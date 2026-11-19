---
"@reactive-agents/reasoning": patch
---

Multi-pass strategies keep stored tool results visible across passes. A kernel pass seeded with an earlier pass's thread (reflexion's improve passes, any strategy passing `initialMessages`) started with an empty scratchpad, so a large tool result stored in an earlier pass showed only its cut preview with no recall hint, and a `tool-result-pairing` warning fired. The pass now resolves the carried refs from the run's scratchpad store and the model sees the result as the earlier pass did.

When a strategy's own check accepts the answer after a pass ended at its cap (reflexion's SATISFIED critique), `outcome.authority` is now `strategy-accepted` instead of the capped pass's `strategy-exhausted`, and the strategy records its own `terminal_decision` for the run. A finalization arm that caps the status (contract coverage, outstanding criteria, a gate refusal) still owns the label.
