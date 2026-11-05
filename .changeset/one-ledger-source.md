---
"@reactive-agents/reasoning": minor
---

Every strategy run now has one ledger source. Tool calls that a strategy runs outside a kernel pass (code-action's sandbox, adaptive's failed sub-strategy) reach the run ledger through the strategy engine, once, and a tool call that is already recorded is never recorded again. `growRunLedger` is no longer exported from `@reactive-agents/reasoning`; it was an internal ledger primitive.
