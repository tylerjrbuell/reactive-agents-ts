---
"@reactive-agents/reasoning": patch
---

RunLedger convergence (Wave C.1): all 8 reasoning strategies now forward `runLedger`
across the result boundary (reflexion projects it from merged steps for completeness
rather than dropping it), so a run's ledger is complete regardless of which strategy
produced it. Receipt tool-call and deliverable evidence are re-based onto ledger queries
first, with the prior steps-derived scan kept as a fallback for paths that have no
ledger. A new `LedgerEntryAppended` live tap publishes ledger batches onto the EventBus
as they're minted, feeding the public `stream(density: "full")` chunk stream and the
`run_events` journal — previously these only existed retrospectively at run completion.
An equivalence invariant (ledger ≡ projection of `steps[]`) is now pinned red-on-cut,
and `steps[]` mutation is gated to a single chokepoint.
